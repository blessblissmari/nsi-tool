/**
 * Офлайн-база моделей оборудования.
 *
 * Источник: пользовательский файл `models_pretty_combined.json` (76 729 моделей,
 * 41 МБ). Очищен и схлопнут по нормализованному коду до 35 181 уникальных
 * моделей с минимум 2 характеристиками каждая (~18 МБ JSON, ~1.2 МБ gz).
 *
 * Файл лежит в `public/models-db.json` и загружается лениво — только когда
 * пользователь нажимает «Из базы моделей» в карточке ТОР.
 */
import { normalizeModelCode } from '../domain/normalize';

export interface DbCharValue {
  /** Сырое значение (как в источнике). */
  v: string;
  /** Единица измерения (если была вынесена в ключ). */
  u?: string;
}

export interface DbModelEntry {
  /** Сырое имя модели как в исходнике (для подсказки пользователю). */
  raw: string;
  /** Карта характеристик: канонический ключ → значение/единица. */
  chars: Record<string, DbCharValue>;
  /** До 3 URL источников (вики/каталоги). */
  sources: string[];
}

export type DbIndex = Record<string, DbModelEntry>;

/** Хранится в памяти после первой загрузки (Promise — чтобы не было гонок). */
let _dbPromise: Promise<DbIndex> | null = null;
let _dbLoaded = false;

/**
 * Декомпрессия gzip-потока через DecompressionStream (нативно в современных
 * браузерах). Падаем в обычный JSON, если браузер не поддерживает.
 */
async function fetchAndDecompressGz(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (typeof DecompressionStream === 'undefined' || !res.body) {
    // Fallback: предположим, что сервер сам распаковал.
    return await res.text();
  }
  const ds = new DecompressionStream('gzip');
  const stream = res.body.pipeThrough(ds);
  const blob = await new Response(stream).blob();
  return await blob.text();
}

/** Лениво подгружает базу моделей. Кэшируется в памяти на время вкладки. */
export function loadModelsDb(): Promise<DbIndex> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    const base = import.meta.env.BASE_URL ?? '/';
    // Сначала пробуем gz (~1.2 МБ вместо 19 МБ).
    try {
      const gzUrl = `${base}models-db.json.gz`;
      const text = await fetchAndDecompressGz(gzUrl);
      const data = JSON.parse(text) as DbIndex;
      _dbLoaded = true;
      return data;
    } catch (e) {
      // Если что-то не так с gz — фоллбек на raw json.
      console.warn('[modelsDb] gz fetch failed, fallback to raw json:', e);
    }
    const res = await fetch(`${base}models-db.json`);
    if (!res.ok)
      throw new Error(`Не удалось загрузить базу моделей: HTTP ${res.status}`);
    const data = (await res.json()) as DbIndex;
    _dbLoaded = true;
    return data;
  })();
  return _dbPromise;
}

export function isModelsDbLoaded(): boolean {
  return _dbLoaded;
}

/** Кэш «short keys» по нормализованному коду из БД (для подстрочного поиска). */
let _shortKeysCache: Map<string, string[]> | null = null;

function getShortKeysCache(db: DbIndex): Map<string, string[]> {
  if (_shortKeysCache) return _shortKeysCache;
  const m = new Map<string, string[]>();
  for (const code of Object.keys(db)) {
    // Берём «ядро» кода: все буквенно-цифровые кластеры длиной ≥ 3.
    const tokens = code.match(/[A-ZА-Я0-9]{3,}/g) ?? [];
    for (const t of tokens) {
      const arr = m.get(t);
      if (arr) arr.push(code);
      else m.set(t, [code]);
    }
  }
  _shortKeysCache = m;
  return m;
}

/**
 * Поиск записи в БД по коду модели.
 *
 * Стратегия:
 *  1. Точное совпадение нормализованного кода.
 *  2. Подстрочное совпадение: код модели — подстрока кода БД, или наоборот
 *     (через индекс по «токенам» длиной ≥ 3 символов).
 *  3. null, если ничего не нашли.
 */
export function lookupModel(
  db: DbIndex,
  rawCode: string | undefined,
  normalizedCode: string | undefined,
): { code: string; entry: DbModelEntry } | null {
  const norm =
    (normalizedCode && normalizedCode.trim()) ||
    (rawCode ? normalizeModelCode(rawCode).code : '');
  if (!norm) return null;

  // 1) Точное.
  if (db[norm]) return { code: norm, entry: db[norm] };

  // 2) Подстрочное.
  const tokens = norm.match(/[A-ZА-Я0-9]{3,}/g) ?? [];
  if (!tokens.length) return null;
  // Берём самый «информативный» токен (самый длинный).
  tokens.sort((a, b) => b.length - a.length);
  const idx = getShortKeysCache(db);
  for (const t of tokens) {
    const candidates = idx.get(t);
    if (!candidates) continue;
    // Среди кандидатов ищем тот, который содержит norm или norm содержит его.
    for (const c of candidates) {
      if (c === norm) return { code: c, entry: db[c] };
      if (c.includes(norm) || norm.includes(c)) {
        return { code: c, entry: db[c] };
      }
    }
  }
  return null;
}

/** Только для тестов / отладки — сбрасывает кеш. */
export function _resetModelsDbCache(): void {
  _dbPromise = null;
  _dbLoaded = false;
  _shortKeysCache = null;
}
