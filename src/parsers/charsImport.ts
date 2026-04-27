/**
 * Импорт характеристик моделей из «Результирующий файл Модели с характ.»
 * Структура: Класс / Подкласс / Модель / Характеристика N / Значение N / Ед.измерения N
 */
import type { SourceKind } from '../domain/types';

export interface CharsImportRow {
  className?: string;
  subclassName?: string;
  modelCode: string;
  source: SourceKind;
  items: Array<{ key: string; valueRaw: string; unit?: string }>;
}

export function rowsToCharsImport(
  rows: Array<Record<string, unknown>>,
  source: SourceKind = 'document',
): CharsImportRow[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const findCol = (test: (h: string) => boolean) =>
    headers.find((h) => test(h.trim().toLowerCase()));
  const cClass = findCol((h) => h === 'класс');
  const cSub = findCol((h) => h === 'подкласс');
  const cModel = findCol((h) => h === 'модель' || h === 'код модели');
  if (!cModel) return [];

  // Триплеты «Характеристика N / Значение N / Ед.измерения N» по индексу N.
  const groups = new Map<
    string,
    { name?: string; value?: string; unit?: string }
  >();
  for (const h of headers) {
    const t = h.trim().toLowerCase();
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^характ[а-яё.]*\s*(\d+)$/))) {
      const k = m[1];
      groups.set(k, { ...(groups.get(k) ?? {}), name: h });
    } else if ((m = t.match(/^значени[ея]\s*(\d+)$/))) {
      const k = m[1];
      groups.set(k, { ...(groups.get(k) ?? {}), value: h });
    } else if ((m = t.match(/^(ед\.?\s*изм[а-яё.]*|единиц[а-яё]*\s*изм[а-яё.]*)\s*(\d+)$/))) {
      const k = m[2];
      groups.set(k, { ...(groups.get(k) ?? {}), unit: h });
    }
  }
  const triplets = Array.from(groups.entries())
    .filter(([, v]) => v.name && v.value)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([, v]) => v);

  if (!triplets.length) return [];

  const out: CharsImportRow[] = [];
  for (const r of rows) {
    const modelCode = String(r[cModel] ?? '').trim();
    if (!modelCode) continue;
    const items: CharsImportRow['items'] = [];
    for (const t of triplets) {
      const key = String(r[t.name!] ?? '').trim();
      const valRaw = r[t.value!];
      if (!key) continue;
      const val =
        valRaw === '' || valRaw == null
          ? ''
          : typeof valRaw === 'number'
            ? String(valRaw).replace('.', ',')
            : String(valRaw).trim();
      if (!val) continue;
      const unit = t.unit ? String(r[t.unit] ?? '').trim() || undefined : undefined;
      items.push({ key, valueRaw: val, unit });
    }
    if (!items.length) continue;
    out.push({
      className: cClass ? String(r[cClass] ?? '').trim() || undefined : undefined,
      subclassName: cSub ? String(r[cSub] ?? '').trim() || undefined : undefined,
      modelCode,
      source,
      items,
    });
  }
  return out;
}

export function looksLikeCharsImport(headers: string[]): boolean {
  const h = headers.map((x) => x.trim().toLowerCase());
  const hasModel = h.some((x) => x === 'модель' || x === 'код модели');
  const hasCharN = h.some((x) => /^характ[а-яё.]*\s*\d+$/.test(x));
  const hasValN = h.some((x) => /^значени[ея]\s*\d+$/.test(x));
  return hasModel && hasCharN && hasValN;
}
