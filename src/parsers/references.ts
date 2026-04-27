/**
 * Парсеры справочников: ВВ и периодичностей, операций, специальностей, единиц измерения.
 * Все справочники не обязательны — используются для autocomplete и нормализации
 * (см. п.8.2 / п.8.4 / п.8.6 ТЗ).
 */
import * as XLSX from 'xlsx';
import type { ReferenceData } from '../domain/types';

export type ReferenceKind =
  | 'actionsRef'
  | 'operationsRef'
  | 'specialtiesRef'
  | 'unitsRef';

/**
 * Определение типа справочника по заголовкам колонок.
 * Возвращает kind и распарсенные данные.
 */
export async function parseReferenceFile(file: File): Promise<{
  kind: ReferenceKind;
  data: Partial<ReferenceData>;
  message: string;
} | null> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    if (!rows.length) continue;
    const headers = Object.keys(rows[0]).map((x) => x.trim().toLowerCase());

    // Справочник ВВ и периодичностей: «Вид воздействия» + «Периодичность».
    if (
      headers.some((h) => /^вид\s+воздействи/.test(h)) &&
      headers.some((h) => /^периодичност/.test(h))
    ) {
      const out: ReferenceData['actions'] = [];
      const colName = Object.keys(rows[0]).find((h) =>
        /^вид\s+воздействи/i.test(h.trim()),
      )!;
      const colPeriod = Object.keys(rows[0]).find((h) =>
        /^периодичност/i.test(h.trim()),
      )!;
      for (const r of rows) {
        const name = String(r[colName] ?? '').trim();
        const periodRaw = r[colPeriod];
        if (!name) continue;
        const period =
          typeof periodRaw === 'number'
            ? periodRaw
            : parseFloat(String(periodRaw).replace(',', '.'));
        if (!isFinite(period)) continue;
        out.push({ name, periodHours: period });
      }
      return {
        kind: 'actionsRef',
        data: { actions: dedupActions(out) },
        message: `Справочник ВВ и периодичностей: ${out.length} строк`,
      };
    }

    // Справочник операций: ищем колонки с «Наименование операции».
    if (
      headers.some((h) =>
        /^наименование\s+(стандарт|вспомогат|операци)/.test(h),
      )
    ) {
      const list: ReferenceData['operations'] = [];
      // Может быть несколько листов — обрабатываем каждый отдельно.
      for (const sn of wb.SheetNames) {
        const rs = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          wb.Sheets[sn],
          { defval: '' },
        );
        if (!rs.length) continue;
        const colOp = Object.keys(rs[0]).find((h) =>
          /^наименование\s+(стандарт|вспомогат|операци)/i.test(h.trim()),
        );
        if (!colOp) continue;
        const isStandard = /стандарт/i.test(colOp);
        for (const r of rs) {
          const name = String(r[colOp] ?? '').trim();
          if (!name || name.length < 2) continue;
          list.push({ name, standard: isStandard || undefined });
        }
      }
      return {
        kind: 'operationsRef',
        data: { operations: dedupOps(list) },
        message: `Справочник операций: ${list.length} строк`,
      };
    }

    // Справочник специальностей и квалификаций.
    if (
      headers.some((h) => /^наименование\s+специальност/.test(h)) &&
      headers.some((h) => /квалификаци/.test(h))
    ) {
      const colName = Object.keys(rows[0]).find((h) =>
        /^наименование\s+специальност/i.test(h.trim()),
      )!;
      const colQual = Object.keys(rows[0]).find((h) =>
        /квалификаци/i.test(h.trim()),
      )!;
      const map = new Map<string, Set<string>>();
      for (const r of rows) {
        const name = String(r[colName] ?? '').trim();
        const qual = String(r[colQual] ?? '').trim();
        if (!name) continue;
        if (!map.has(name)) map.set(name, new Set());
        if (qual) map.get(name)!.add(qual);
      }
      const list = Array.from(map.entries())
        .map(([name, q]) => ({ name, qualifications: Array.from(q) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      return {
        kind: 'specialtiesRef',
        data: { specialties: list },
        message: `Справочник специальностей: ${list.length} (квалификаций ${rows.length})`,
      };
    }

    // Справочник единиц измерения / характеристик (ГОСТ 8.417).
    if (
      headers.some((h) => /физическая\s+величин/.test(h)) ||
      (headers.some((h) => /единиц[ау]\s+измерени/.test(h)) &&
        headers.some((h) => /(российское|обозначен)/.test(h)))
    ) {
      const cQty = Object.keys(rows[0]).find((h) =>
        /физическая\s+величин/i.test(h.trim()),
      );
      const cUnit = Object.keys(rows[0]).find((h) =>
        /единиц[ау]\s+измерени/i.test(h.trim()),
      );
      const cRu = Object.keys(rows[0]).find((h) =>
        /российское\s+обозначен/i.test(h.trim()),
      );
      const cIntl = Object.keys(rows[0]).find((h) =>
        /международное\s+обозначен/i.test(h.trim()),
      );
      const cRel = Object.keys(rows[0]).find((h) =>
        /соотношен/i.test(h.trim()),
      );
      const out: ReferenceData['units'] = [];
      for (const r of rows) {
        const quantity = cQty ? String(r[cQty] ?? '').trim() : '';
        const unit = cUnit ? String(r[cUnit] ?? '').trim() : '';
        if (!quantity && !unit) continue;
        out.push({
          quantity,
          unit,
          symbolRu: cRu ? String(r[cRu] ?? '').trim() || undefined : undefined,
          symbolIntl: cIntl
            ? String(r[cIntl] ?? '').trim() || undefined
            : undefined,
          relation: cRel
            ? String(r[cRel] ?? '').trim() || undefined
            : undefined,
        });
      }
      return {
        kind: 'unitsRef',
        data: { units: out },
        message: `Справочник единиц измерения: ${out.length} строк`,
      };
    }
  }
  return null;
}

export function looksLikeReferenceFile(headers: string[]): boolean {
  const h = headers.map((x) => x.trim().toLowerCase());
  return (
    h.some((x) => /^вид\s+воздействи/.test(x)) ||
    h.some((x) => /^наименование\s+(стандарт|вспомогат|операци)/.test(x)) ||
    h.some((x) => /^наименование\s+специальност/.test(x)) ||
    h.some((x) => /физическая\s+величин/.test(x))
  );
}

function dedupActions(
  list: Array<{ name: string; periodHours: number }>,
): Array<{ name: string; periodHours: number }> {
  const m = new Map<string, Set<number>>();
  for (const x of list) {
    if (!m.has(x.name)) m.set(x.name, new Set());
    m.get(x.name)!.add(x.periodHours);
  }
  const out: Array<{ name: string; periodHours: number }> = [];
  for (const [name, hours] of m) {
    for (const h of Array.from(hours).sort((a, b) => a - b)) {
      out.push({ name, periodHours: h });
    }
  }
  return out;
}

function dedupOps(
  list: Array<{ name: string; standard?: boolean }>,
): Array<{ name: string; standard?: boolean }> {
  const m = new Map<string, boolean>();
  for (const x of list) {
    const cur = m.get(x.name);
    m.set(x.name, cur === true ? true : !!x.standard);
  }
  return Array.from(m.entries())
    .map(([name, standard]) => ({ name, standard: standard || undefined }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
