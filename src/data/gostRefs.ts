/**
 * Справочник ГОСТов на типовые ТМЦ оборудования (созвон 28.04.2026:
 * «поиск по ГОСТ, номенклатурам и т.д.»). Используется в окне Аналоги
 * и в Спецификациях для подсветки ТМЦ соответствующим стандартом и для
 * быстрого поиска ТМЦ по номеру/названию ГОСТа.
 *
 * Стартовый набор — ~50 наиболее распространённых ГОСТов на:
 *   - крепёж и метизы (болты, гайки, шайбы, шпильки)
 *   - подшипники
 *   - трубопроводы и фланцы
 *   - уплотнения, прокладки, сальники
 *   - смазочные материалы
 *   - арматуру (задвижки, краны)
 *   - кабели и электротехнику
 *
 * Источник истины — `gostRefs.json` (легко правится без пересборки кода).
 */
import gostJson from './gostRefs.json';

export interface GostRef {
  gost: string;
  title: string;
  keywords: string[];
}

const SOURCE = (gostJson as { items: GostRef[] }).items;

/** Канонизация: убираем лишние пробелы, к нижнему регистру. */
function canon(s: string): string {
  return (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Все ГОСТы в исходном порядке. */
export const GOST_REFS: GostRef[] = SOURCE.slice();

/**
 * Поиск ГОСТов по строке-запросу. Сравниваем по номеру ГОСТа, заголовку
 * и ключевым словам. Возвращаем первые `limit` совпадений.
 */
export function searchGosts(query: string, limit = 10): GostRef[] {
  const q = canon(query);
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const score = (g: GostRef): number => {
    const hay = canon(`${g.gost} ${g.title} ${g.keywords.join(' ')}`);
    let s = 0;
    for (const t of tokens) {
      if (!t) continue;
      if (canon(g.gost).includes(t)) s += 5;
      if (canon(g.title).includes(t)) s += 2;
      if (g.keywords.some((k) => canon(k).includes(t))) s += 4;
      if (hay.includes(t)) s += 1;
    }
    return s;
  };
  return SOURCE.map((g) => ({ g, s: score(g) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.g);
}

/**
 * Подобрать первый подходящий ГОСТ по названию ТМЦ. Используется для
 * автоматической пометки строк BOM/APL соответствующим стандартом.
 */
export function matchGostForTmc(tmcName: string): GostRef | undefined {
  const found = searchGosts(tmcName, 1);
  return found[0];
}
