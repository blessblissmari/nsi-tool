/**
 * Извлечение характеристик из распознанного текста паспорта/РЭ.
 * Демо-версия: построчный поиск пар «ключ: значение» с маппингом
 * на приоритетные характеристики класса/подкласса.
 */

import type {
  Characteristic,
  ClassDef,
  PriorityCharDef,
  SubclassDef,
} from './types';
import { parseValue } from './units';

function newId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9% ]+/giu, ' ').trim();
}

function getPriority(
  cls?: ClassDef,
  sub?: SubclassDef,
): PriorityCharDef[] {
  const result: PriorityCharDef[] = [];
  const seen = new Set<string>();
  const add = (defs?: PriorityCharDef[]) => {
    if (!defs) return;
    for (const d of defs) {
      const key = norm(d.key);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(d);
    }
  };
  add(sub?.priorityChars);
  add(cls?.priorityChars);
  return result;
}

function tokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Возвращает best-match с приоритетом: exact > все слова ключа в строке > длинная подстрока. */
function findPriorityMatch(
  key: string,
  priority: PriorityCharDef[],
): PriorityCharDef | undefined {
  const k = norm(key);
  const kTokens = new Set(tokens(k));
  let best: { def: PriorityCharDef; score: number } | undefined;

  for (const p of priority) {
    const candidates = [p.key, ...(p.aliases ?? [])]
      .map(norm)
      .filter(Boolean);
    for (const c of candidates) {
      let score = 0;
      if (k === c) score = 100;
      else {
        const cTokens = tokens(c);
        // Все слова кандидата присутствуют в k (по точному совпадению токена).
        const allWordsMatch =
          cTokens.length > 0 && cTokens.every((t) => kTokens.has(t));
        if (allWordsMatch) score = 50 + c.length;
        else if (c.length >= 4 && k.includes(c)) score = 10 + c.length;
        else if (c.length >= 4 && c.includes(k) && k.length >= 4)
          score = 5 + k.length;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { def: p, score };
      }
    }
  }
  return best?.def;
}

/** Разделители между ключом и значением: : — – = (после ключа). */
const SEPARATORS = /[:\u2014\u2013=]\s*/;

/** Extended separators for table-like documents: also match multiple spaces and tabs. */
const TABLE_SEPARATORS = /(?:[:\u2014\u2013=]|\t|\s{3,})\s*/;

/**
 * Разбирает текст на пары «ключ: значение» с привязкой к приоритетным
 * характеристикам. Supports:
 * - Standard «ключ: значение» and «ключ = значение» formats
 * - Table-like formats with tabs or multiple spaces
 * - Lines where the key is a known priority characteristic name
 */
export function parseCharacteristics(
  text: string,
  cls?: ClassDef,
  sub?: SubclassDef,
  documentId?: string,
): Characteristic[] {
  if (!text.trim()) return [];
  const priority = getPriority(cls, sub);
  const out: Characteristic[] = [];
  const seenKeys = new Set<string>();
  // Делим на строки. Также допускаем «ключ: значение; ключ: значение» в одной строке.
  const lines = text
    .split(/[\r\n]+/)
    .flatMap((l) => l.split(/;\s+/))
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Skip overly long lines (likely paragraphs, not key-value pairs)
    if (line.length > 200) continue;
    // Skip lines that look like headers or titles (all caps, no separator)
    if (/^[A-ZА-ЯЁ\s.]{5,}$/.test(line) && !SEPARATORS.test(line)) continue;

    let rawKey: string | undefined;
    let rawVal: string | undefined;

    // Try standard separators first
    const m = SEPARATORS.exec(line);
    if (m && m.index > 0 && m.index < 80) {
      rawKey = line.slice(0, m.index).trim();
      rawVal = line.slice(m.index + m[0].length).trim();
    }

    // If no standard match, try table-like separators
    if (!rawKey || !rawVal) {
      const mt = TABLE_SEPARATORS.exec(line);
      if (mt && mt.index > 0 && mt.index < 80) {
        rawKey = line.slice(0, mt.index).trim();
        rawVal = line.slice(mt.index + mt[0].length).trim();
      }
    }

    // If still nothing, check if the line starts with a known priority characteristic
    if (!rawKey || !rawVal) {
      for (const p of priority) {
        const candidates = [p.key, ...(p.aliases ?? [])];
        for (const c of candidates) {
          const lc = line.toLowerCase();
          const cc = c.toLowerCase();
          if (lc.startsWith(cc) && line.length > c.length + 1) {
            const rest = line.slice(c.length).trim();
            // Strip leading separator if present
            const cleaned = rest.replace(/^[:\u2014\u2013=\s]+/, '').trim();
            if (cleaned && cleaned.length < 100) {
              rawKey = c;
              rawVal = cleaned;
              break;
            }
          }
        }
        if (rawKey) break;
      }
    }

    if (!rawKey || !rawVal) continue;
    if (rawKey.length > 80) continue;
    // Filter out non-characteristic content (random text)
    // Skip if value looks like a sentence (too many words, no numbers for numeric chars)
    const wordCount = rawVal.split(/\s+/).length;
    if (wordCount > 8) continue; // Likely descriptive text, not a characteristic value

    const pv = parseValue(rawVal);
    const matched = findPriorityMatch(rawKey, priority);
    const keyDisplay = matched?.key ?? rawKey;
    const order = matched ? priority.findIndex((p) => p.key === matched.key) : undefined;
    
    // Deduplicate: skip if we already have this key
    const normKey = norm(keyDisplay);
    if (seenKeys.has(normKey)) continue;
    seenKeys.add(normKey);

    out.push({
      id: newId(),
      key: keyDisplay,
      valueRaw: rawVal,
      valueNum: pv.num,
      unit: pv.unit,
      targetUnit: matched?.unit,
      isPriority: !!matched,
      priorityOrder: order !== undefined && order >= 0 ? order : undefined,
      source: 'document',
      documentId,
    });
  }
  return out;
}

/**
 * Сортирует характеристики: приоритетные сначала (по priorityOrder),
 * затем остальные (по ключу).
 */
export function sortCharacteristics(chars: Characteristic[]): Characteristic[] {
  return [...chars].sort((a, b) => {
    if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
    if (a.isPriority && b.isPriority) {
      const oa = a.priorityOrder ?? 999;
      const ob = b.priorityOrder ?? 999;
      if (oa !== ob) return oa - ob;
    }
    return a.key.localeCompare(b.key, 'ru');
  });
}

/**
 * Возвращает список приоритетных характеристик, к которым ещё нет значения.
 * Используется для подсказки эксперту в карточке.
 */
export function missingPriorityChars(
  chars: Characteristic[],
  cls?: ClassDef,
  sub?: SubclassDef,
): PriorityCharDef[] {
  const priority = getPriority(cls, sub);
  if (priority.length === 0) return [];
  const present = new Set(
    chars.filter((c) => c.isPriority).map((c) => norm(c.key)),
  );
  return priority.filter((p) => !present.has(norm(p.key)));
}
