import * as XLSX from 'xlsx';

/**
 * Импорт «Классификации моделей» — простой маппинг
 *   Класс | Подкласс | Модель
 * (Файл «Классификация моделей.xlsx».)
 *
 * Возвращает массив записей; код модели сравнивается с rawCode и normalizedCode
 * без учёта регистра и пробелов.
 */
export interface ClassificationRow {
  className: string;
  subclassName?: string;
  modelCode: string;
}

export async function parseClassificationFile(
  file: File,
): Promise<ClassificationRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  return rowsToClassification(rows);
}

export function rowsToClassification(
  rows: Array<Record<string, unknown>>,
): ClassificationRow[] {
  const result: ClassificationRow[] = [];
  for (const row of rows) {
    const className = pick(row, ['Класс', 'class']);
    const subclassName = pick(row, ['Подкласс', 'subclass']);
    const modelCode = pick(row, ['Модель', 'Код модели', 'Код', 'model']);
    if (!className || !modelCode) continue;
    result.push({
      className,
      subclassName: subclassName || undefined,
      modelCode,
    });
  }
  return result;
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
