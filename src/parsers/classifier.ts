import * as XLSX from 'xlsx';
import type { Classifier, ClassDef, PriorityCharDef, SubclassDef } from '../domain/types';

/**
 * Импорт классификатора из xlsx.
 *
 * Поддерживается основной формат («Классификатор.xlsx»):
 *   Класс | Подкласс | Характеристика 1 | Ед.измерения 1 | Хар-ка 2 | Ед.изм 2 | …
 * Колонок «Хар-ка/Ед.изм» может быть произвольное число (обычно 5).
 *
 * Совместимость: старый формат
 *   Класс | Подкласс | Ключевые слова | Шаблоны
 * также распознаётся.
 */
export async function parseClassifierFile(file: File): Promise<Classifier> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  return rowsToClassifier(rows);
}

export function rowsToClassifier(rows: Array<Record<string, unknown>>): Classifier {
  const byClass = new Map<string, ClassDef>();
  const sample = rows[0] || {};
  const headers = Object.keys(sample);

  // Определяем «характеристика N» / «ед. изм N» колонки. Парная привязка по
  // ближайшей единице измерения справа от характеристики.
  type CharSpec = { keyCol: string; unitCol?: string; order: number };
  const charSpecs: CharSpec[] = [];
  const charRe = /^(хар(акт)?[а-яё.-]*)\s*(\d+)$/i;
  const unitRe = /^(ед[а-яё.-]*\s*изм[а-яё.-]*|единиц[а-яё.-]*\s*измерен[а-яё.-]*)\s*(\d+)$/i;
  const charByIdx = new Map<number, string>();
  const unitByIdx = new Map<number, string>();
  for (const h of headers) {
    const norm = String(h).trim().toLowerCase();
    let m = charRe.exec(norm);
    if (m) {
      charByIdx.set(parseInt(m[3], 10), h);
      continue;
    }
    m = unitRe.exec(norm);
    if (m) {
      unitByIdx.set(parseInt(m[2], 10), h);
    }
  }
  Array.from(charByIdx.keys())
    .sort((a, b) => a - b)
    .forEach((idx) => {
      charSpecs.push({
        keyCol: charByIdx.get(idx)!,
        unitCol: unitByIdx.get(idx),
        order: idx,
      });
    });

  for (const row of rows) {
    const className = pick(row, ['Класс', 'class']);
    const subclassName = pick(row, ['Подкласс', 'subclass']);
    if (!className) continue;

    if (!byClass.has(className)) {
      byClass.set(className, { name: className, subclasses: [] });
    }
    const cls = byClass.get(className)!;

    // Извлекаем приоритетные характеристики из колонок «Хар-ка N»/«Ед.изм N».
    const priorityChars: PriorityCharDef[] = [];
    for (const spec of charSpecs) {
      const key = String(row[spec.keyCol] ?? '').trim();
      const unit = spec.unitCol ? String(row[spec.unitCol] ?? '').trim() : '';
      if (!key) continue;
      const def: PriorityCharDef = { key };
      if (unit) def.unit = unit;
      def.type = unit && unit.toLowerCase() === 'текст' ? 'text' : 'number';
      priorityChars.push(def);
    }

    // Совместимость со старым форматом: «Ключевые слова», «Шаблоны».
    const kwRaw = pick(row, ['Ключевые слова', 'keywords']);
    const patRaw = pick(row, ['Шаблоны', 'patterns']);
    const keywords = splitList(kwRaw);
    const patterns = splitList(patRaw);

    if (subclassName) {
      const sub: SubclassDef = { name: subclassName };
      if (priorityChars.length) sub.priorityChars = priorityChars;
      if (keywords.length) sub.keywords = keywords;
      if (patterns.length) sub.patterns = patterns;
      // Дедуплицируем подклассы внутри класса.
      const existing = cls.subclasses.find((x) => x.name === sub.name);
      if (existing) {
        if (sub.priorityChars && !existing.priorityChars)
          existing.priorityChars = sub.priorityChars;
        if (sub.keywords)
          existing.keywords = (existing.keywords ?? []).concat(sub.keywords);
        if (sub.patterns)
          existing.patterns = (existing.patterns ?? []).concat(sub.patterns);
      } else {
        cls.subclasses.push(sub);
      }
    } else {
      // Без подкласса — характеристики и ключевые слова навешиваем на класс.
      if (priorityChars.length) cls.priorityChars = priorityChars;
      if (keywords.length) cls.keywords = (cls.keywords ?? []).concat(keywords);
    }
  }
  return { classes: Array.from(byClass.values()) };
}

function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    for (const rk of Object.keys(row)) {
      if (rk.trim().toLowerCase() === k.toLowerCase()) {
        return String(row[rk] ?? '').trim();
      }
    }
  }
  return '';
}

function splitList(s: string): string[] {
  return s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}
