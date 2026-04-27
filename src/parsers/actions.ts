import * as XLSX from 'xlsx';
import type { ActionKind, SourceKind } from '../domain/types';

export interface ActionsImportRow {
  className?: string;
  subclassName?: string;
  modelCode: string;
  /** «ист»/«инт»/document/etc. — определяется источником импорта. */
  source: SourceKind;
  items: Array<{
    name: string;
    periodHours?: number;
    kind?: ActionKind;
  }>;
}

export async function parseActionsFile(
  file: File,
): Promise<ActionsImportRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
  });
  const src: SourceKind = /\bинт\b|интер/i.test(file.name) ? 'web' : 'analog';
  return rowsToActions(rows, src);
}

export function rowsToActions(
  rows: Array<Record<string, unknown>>,
  source: SourceKind,
): ActionsImportRow[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const findCol = (test: (h: string) => boolean) =>
    headers.find((h) => test(h.trim().toLowerCase()));
  const cClass = findCol((h) => h === 'класс');
  const cSub = findCol((h) => h === 'подкласс');
  const cModel = findCol((h) => h === 'модель' || h === 'код модели');
  if (!cModel) return [];

  // Соответствие «ВВ N» ↔ «Периодичность N» по индексу.
  const vvCols: Array<{ name: string; period?: string; idx: number }> = [];
  const re = /^вв\s*(\d+)$/i;
  const reP = /^период[а-яё.]*\s*(\d+)$/i;
  const periodMap = new Map<string, string>();
  for (const h of headers) {
    const m = h.match(reP);
    if (m) periodMap.set(m[1], h);
  }
  for (const h of headers) {
    const m = h.match(re);
    if (m) {
      const idx = parseInt(m[1], 10);
      vvCols.push({ name: h, period: periodMap.get(m[1]), idx });
    }
  }
  vvCols.sort((a, b) => a.idx - b.idx);

  const out: ActionsImportRow[] = [];
  for (const r of rows) {
    const modelCode = String(r[cModel] ?? '').trim();
    if (!modelCode) continue;
    const items: ActionsImportRow['items'] = [];
    for (const c of vvCols) {
      const name = String(r[c.name] ?? '').trim();
      if (!name) continue;
      const ph = c.period ? r[c.period] : undefined;
      const periodHours =
        ph === '' || ph == null
          ? undefined
          : typeof ph === 'number'
            ? ph
            : parseFloat(String(ph).replace(/\s/g, '').replace(',', '.')) ||
              undefined;
      items.push({ name, periodHours, kind: detectKind(name) });
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

function detectKind(name: string): ActionKind {
  const u = name.toUpperCase();
  if (/^ТО/.test(u)) return 'TO';
  if (/^ТР/.test(u)) return 'repair';
  if (/^КР/.test(u)) return 'repair';
  if (/^ОСМ|^ОБХ/.test(u)) return 'inspection';
  if (/^ДИА/.test(u)) return 'diagnostic';
  return 'other';
}

/** Проверка по заголовкам — выглядит ли файл как ВВ? */
export function looksLikeActionsFile(headers: string[]): boolean {
  const h = headers.map((x) => x.trim().toLowerCase());
  const hasModel = h.some((x) => x === 'модель' || x === 'код модели');
  const hasVV = h.some((x) => /^вв\s*\d+$/.test(x));
  return hasModel && hasVV;
}
