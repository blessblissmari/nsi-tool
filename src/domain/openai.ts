/**
 * Реализация AiProvider поверх OpenAI Chat Completions API.
 * Модель: gpt-4o-mini ($0.150 / 1M входных токенов, $0.600 / 1M выходных).
 *
 * Экономия:
 *  - Кэширование результатов в localStorage по содержательному ключу,
 *    чтобы повторные клики не тратили токены.
 *  - JSON-mode → меньше «размышлений» в выходе, выше предсказуемость парсинга.
 *  - Жёсткое ограничение `max_tokens` под задачу.
 *  - Учёт фактического `usage.{prompt_tokens, completion_tokens}` —
 *    счётчик расхода в долларах виден в шапке UI.
 */
import type {
  ActionItem,
  Characteristic,
  ClassDef,
  ClassificationProposal,
  EquipmentModel,
} from './types';
import type { AiProvider } from './ai';

const MODEL = 'gpt-4o-mini';
const PRICE_PROMPT_PER_M = 0.15; // USD / 1M токенов
const PRICE_COMPLETION_PER_M = 0.6;

const KEY_STORAGE = 'nsi_openai_api_key';
const USAGE_STORAGE = 'nsi_openai_usage';
const CACHE_STORAGE = 'nsi_openai_cache';

export interface AiUsage {
  /** Количество API-запросов всего. */
  requests: number;
  promptTokens: number;
  completionTokens: number;
  /** Оценка стоимости в долларах США. */
  costUsd: number;
}

export function readUsage(): AiUsage {
  try {
    return JSON.parse(localStorage.getItem(USAGE_STORAGE) || '');
  } catch {
    return { requests: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
  }
}

function writeUsage(u: AiUsage): void {
  localStorage.setItem(USAGE_STORAGE, JSON.stringify(u));
  window.dispatchEvent(new CustomEvent('nsi:ai-usage', { detail: u }));
}

export function resetUsage(): void {
  writeUsage({ requests: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 });
}

export function getApiKey(): string | undefined {
  const k = localStorage.getItem(KEY_STORAGE);
  return k && k.trim() ? k.trim() : undefined;
}

export function setApiKey(key: string): void {
  if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
  else localStorage.removeItem(KEY_STORAGE);
  window.dispatchEvent(new CustomEvent('nsi:ai-key-changed'));
}

interface CacheEntry {
  ts: number;
  value: unknown;
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_STORAGE) || '{}');
  } catch {
    return {};
  }
}

function writeCache(map: Record<string, CacheEntry>): void {
  // Кэш не должен распухать — храним последние 200 записей.
  const entries = Object.entries(map).sort((a, b) => b[1].ts - a[1].ts);
  const trimmed = Object.fromEntries(entries.slice(0, 200));
  try {
    localStorage.setItem(CACHE_STORAGE, JSON.stringify(trimmed));
  } catch {
    // localStorage переполнен — просто чистим.
    localStorage.removeItem(CACHE_STORAGE);
  }
}

export function clearCache(): void {
  localStorage.removeItem(CACHE_STORAGE);
}

async function callOpenAI<T>(
  cacheKey: string,
  body: {
    system: string;
    user: string;
    maxTokens: number;
    schema?: string;
  },
): Promise<T | undefined> {
  const cache = readCache();
  if (cache[cacheKey]) {
    return cache[cacheKey].value as T;
  }
  const key = getApiKey();
  if (!key) throw new Error('Не задан OpenAI API ключ. Settings → Ключ ИИ.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: body.system },
        { role: 'user', content: body.user },
      ],
      max_tokens: body.maxTokens,
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const usage = json.usage ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
  };
  const u = readUsage();
  u.requests += 1;
  u.promptTokens += usage.prompt_tokens || 0;
  u.completionTokens += usage.completion_tokens || 0;
  u.costUsd =
    (u.promptTokens * PRICE_PROMPT_PER_M) / 1_000_000 +
    (u.completionTokens * PRICE_COMPLETION_PER_M) / 1_000_000;
  writeUsage(u);

  const content = json.choices?.[0]?.message?.content;
  if (!content) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  cache[cacheKey] = { ts: Date.now(), value: parsed };
  writeCache(cache);
  return parsed as T;
}

function fingerprint(...parts: unknown[]): string {
  // Лёгкий хэш на частях входа — нужен только для дедупликации в кэше.
  const s = parts.map((p) => JSON.stringify(p)).join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export const openaiAiProvider: AiProvider = {
  async classify(input: {
    model: Pick<EquipmentModel, 'rawCode' | 'normalizedCode'>;
    classes: ClassDef[];
    docText?: string;
  }): Promise<ClassificationProposal[]> {
    const code = input.model.normalizedCode || input.model.rawCode;
    const classOptions = input.classes.map((c) => ({
      name: c.name,
      subclasses: c.subclasses.map((s) => s.name),
    }));
    const cacheKey =
      'classify:' + fingerprint(code, classOptions, input.docText?.slice(0, 200));

    const docSnippet = (input.docText || '').slice(0, 1500);
    const system =
      'Ты помощник по классификации промышленного оборудования. ' +
      'Из приведённого списка классов и подклассов выбери наиболее подходящий ' +
      'для указанного кода модели. Возвращай ТОЛЬКО json вида ' +
      '{"items":[{"className":"...","subclassName":"...","confidence":0.0-1.0,"reason":"..."}]}. ' +
      'Используй только классы и подклассы из списка. Если не уверен — confidence низкий. ' +
      'Не более 3 кандидатов.';
    const user = `Код модели: ${code}
Доступные классы и подклассы (JSON):
${JSON.stringify(classOptions, null, 0)}
${docSnippet ? `Фрагмент документа:\n${docSnippet}` : ''}`;
    type Out = { items?: Array<{ className: string; subclassName?: string; confidence?: number; reason?: string }> };
    const result = await callOpenAI<Out>(cacheKey, {
      system,
      user,
      maxTokens: 300,
    });
    if (!result?.items) return [];
    const validClasses = new Set(input.classes.map((c) => c.name));
    return result.items
      .filter((x) => x.className && validClasses.has(x.className))
      .slice(0, 3)
      .map((x) => ({
        className: x.className,
        subclassName: x.subclassName,
        confidence: typeof x.confidence === 'number' ? x.confidence : 0.5,
        reason: x.reason || 'Предложение ИИ',
        source: 'ai' as const,
      }));
  },

  async extractCharacteristics(input: {
    text: string;
    keys: Array<{ key: string; unit?: string }>;
  }): Promise<Array<Pick<Characteristic, 'key' | 'valueRaw' | 'unit'>>> {
    const text = input.text.slice(0, 6000);
    const cacheKey = 'chars:' + fingerprint(input.keys, text);
    const system =
      'Извлеки значения характеристик из текста паспорта/руководства оборудования. ' +
      'Заполняй ТОЛЬКО запрошенные ключи (точные названия). ' +
      'Возвращай json {"items":[{"key":"...","valueRaw":"...","unit":"..."}]}. ' +
      'Если значения нет — не включай ключ. valueRaw — строка как в источнике, ' +
      'unit — единица как указана (например "кВт", "м3/мин"). ' +
      'Числа сохраняй в исходном формате (запятая → точка не делай, парсер сам сделает).';
    const user = `Запрошенные ключи: ${JSON.stringify(input.keys)}
Текст:
${text}`;
    type Out = { items?: Array<{ key: string; valueRaw: string; unit?: string }> };
    const result = await callOpenAI<Out>(cacheKey, {
      system,
      user,
      maxTokens: 600,
    });
    if (!result?.items) return [];
    const validKeys = new Set(input.keys.map((k) => k.key));
    return result.items.filter(
      (x) => x.key && x.valueRaw && validKeys.has(x.key),
    );
  },

  async suggestActions(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode'>;
  }): Promise<
    Array<Pick<ActionItem, 'name' | 'kind' | 'periodHours'> & { reason?: string }>
  > {
    const cacheKey = 'actions:' + fingerprint(input.model);
    const system =
      'Ты эксперт ТОиР. Предложи типовой набор видов воздействия (ВВ) для модели ' +
      'оборудования с указанной периодичностью в часах наработки. ' +
      'Используй стандартные обозначения: «ТО-1», «ТО-2», «ТО-3», «ТО-4», «ТР-1», «ТР-2», «КР-1», «КР-2», «КР-3». ' +
      'Возвращай json {"items":[{"name":"ТО-1","kind":"TO|repair|inspection|diagnostic","periodHours":<число>,"reason":"..."}]}. ' +
      '5–9 строк. periodHours — целое число часов. ' +
      'Без пояснений снаружи json.';
    const user = `Класс: ${input.model.className ?? '—'}
Подкласс: ${input.model.subclassName ?? '—'}
Модель: ${input.model.normalizedCode ?? '—'}`;
    type Out = {
      items?: Array<{
        name: string;
        kind?: ActionItem['kind'];
        periodHours?: number;
        reason?: string;
      }>;
    };
    const result = await callOpenAI<Out>(cacheKey, {
      system,
      user,
      maxTokens: 500,
    });
    if (!result?.items) return [];
    return result.items
      .filter((x) => x.name && typeof x.periodHours === 'number')
      .slice(0, 12);
  },

  async enrichCharacteristicsFromWeb(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
    keys: Array<{ key: string; unit?: string }>;
  }): Promise<
    Array<
      Pick<Characteristic, 'key' | 'valueRaw' | 'unit'> & {
        confidence?: number;
        reason?: string;
      }
    >
  > {
    const code =
      input.model.normalizedCode || input.model.rawCode || '';
    const cacheKey =
      'enrichChars:' +
      fingerprint(
        code,
        input.model.className,
        input.model.subclassName,
        input.keys,
      );
    const system =
      'Ты помощник по паспортным характеристикам промышленного оборудования. ' +
      'На основании общедоступных каталогов и руководств производителей ' +
      'верни типовые/паспортные значения запрошенных характеристик для указанной модели. ' +
      'Если по конкретной модели данных нет — пропусти ключ (не угадывай). ' +
      'Возвращай ТОЛЬКО json вида ' +
      '{"items":[{"key":"...","valueRaw":"...","unit":"...","confidence":0.0-1.0,"reason":"кратко источник/обоснование"}]}. ' +
      'valueRaw — численное/строковое значение (без формул); ' +
      'unit — единица в той форме, что попросили (или ближайшая). ' +
      'confidence: 0.9 если параметр стандартный для серии и однозначен, ' +
      '0.6–0.8 если есть разброс по модификациям, 0.3–0.5 если значение оценочное.';
    const user = `Модель: ${code}
Класс: ${input.model.className ?? '—'}
Подкласс: ${input.model.subclassName ?? '—'}
Запрошенные характеристики (JSON): ${JSON.stringify(input.keys)}`;
    type Out = {
      items?: Array<{
        key: string;
        valueRaw: string;
        unit?: string;
        confidence?: number;
        reason?: string;
      }>;
    };
    const result = await callOpenAI<Out>(cacheKey, {
      system,
      user,
      maxTokens: 600,
    });
    if (!result?.items) return [];
    const validKeys = new Set(input.keys.map((k) => k.key));
    return result.items
      .filter((x) => x.key && x.valueRaw && validKeys.has(x.key))
      .map((x) => ({
        key: x.key,
        valueRaw: x.valueRaw,
        unit: x.unit,
        confidence:
          typeof x.confidence === 'number' ? x.confidence : undefined,
        reason: x.reason,
      }));
  },
};
