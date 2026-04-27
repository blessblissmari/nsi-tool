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
import {
  BOM_BY_CLASS,
  bomFewShot,
  techCardFewShot,
} from '../data/realBomAndTechCards';

/**
 * Основная модель — дешёвая. Используется для классификации, подбора
 * ВВ, извлечения характеристик. Выдаёт нормальный результат на типовых
 * задачах, но на «творческих» (техкарты, BOM) склонна придумывать.
 */
const MODEL_FAST = 'gpt-4o-mini';
/**
 * Большая модель — для задач, где важна достоверность (техкарты по
 * шаблону, типовой BOM/APL из интернета). В ≈16× дороже по выходу,
 * но содержательно пишет так, как в реальных паспортах.
 */
const MODEL_QUALITY = 'gpt-4o';
const PRICE_FAST_PROMPT = 0.15; // USD / 1M
const PRICE_FAST_COMPLETION = 0.6;
const PRICE_QUALITY_PROMPT = 2.5;
const PRICE_QUALITY_COMPLETION = 10.0;

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
    /** Если true — игнорировать кэш и перезаписать его. */
    bypassCache?: boolean;
    /** Если задано — не кэшировать, когда функция вернула «пусто». */
    isEmpty?: (value: unknown) => boolean;
    /** Какую модель использовать. По умолчанию gpt-4o-mini. */
    model?: 'fast' | 'quality';
  },
): Promise<T | undefined> {
  const cache = readCache();
  if (!body.bypassCache && cache[cacheKey]) {
    return cache[cacheKey].value as T;
  }
  const key = getApiKey();
  if (!key) throw new Error('Не задан OpenAI API ключ. Settings → Ключ ИИ.');

  const useQuality = body.model === 'quality';
  const modelName = useQuality ? MODEL_QUALITY : MODEL_FAST;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: modelName,
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
  const pIn = useQuality ? PRICE_QUALITY_PROMPT : PRICE_FAST_PROMPT;
  const pOut = useQuality ? PRICE_QUALITY_COMPLETION : PRICE_FAST_COMPLETION;
  u.costUsd +=
    ((usage.prompt_tokens || 0) * pIn +
      (usage.completion_tokens || 0) * pOut) /
    1_000_000;
  writeUsage(u);

  const content = json.choices?.[0]?.message?.content;
  if (!content) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  // Не кэшируем пустые ответы — чтобы повторный клик реально повторил
  // запрос (иначе `bom/apl не ищется`: первый пустой ответ навсегда
  // залипает в localStorage).
  const empty = body.isEmpty?.(parsed) ?? false;
  if (!empty) {
    cache[cacheKey] = { ts: Date.now(), value: parsed };
    writeCache(cache);
  }
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
      isEmpty: (v) => {
        const items = (v as Out | undefined)?.items;
        return !items || items.length === 0;
      },
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
      isEmpty: (v) => {
        const items = (v as Out | undefined)?.items;
        return !items || items.length === 0;
      },
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
      'Ты эксперт ТОиР. Предложи типовой набор видов воздействия (ВВ) ' +
      'для модели оборудования с указанной периодичностью в часах ' +
      'наработки. Используй стандартные обозначения: «ЕО» (ежесменное), ' +
      '«ТО-1», «ТО-2», «ТО-3», «ТО-4», «ТР-1», «ТР-2», «КР-1», «КР-2», ' +
      '«КР-3». ' +
      'ПРАВИЛА: ' +
      '(1) Периодичности должны быть убывающе-иерархичны: ' +
      'ЕО ≈ 8-24 ч, ТО-1 ≈ 120-500 ч, ТО-2 ≈ 2000-3000 ч, ' +
      'ТО-3 ≈ 4000-6000 ч, ТР-1 ≈ 6000-8000 ч, ТР-2 ≈ 12000-18000 ч, ' +
      'КР-1 ≈ 20000-30000 ч, КР-2 ≈ 40000-50000 ч. ' +
      '(2) kind: "TO" для ЕО/ТО-*, "repair" для ТР-*/КР-*, ' +
      '"inspection" для осмотров, "diagnostic" для диагностик. ' +
      '(3) reason — краткое обоснование (1 строка): что входит в ВВ. ' +
      'Возвращай json {"items":[{"name":"ТО-1","kind":"TO","periodHours":250,"reason":"..."}]}. ' +
      '5–9 строк, periodHours — целое число часов.';
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
      maxTokens: 700,
      isEmpty: (v) => {
        const items = (v as Out | undefined)?.items;
        return !items || items.length === 0;
      },
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
      'верни типовые/паспортные значения запрошенных характеристик для ' +
      'указанной модели. ' +
      'СТРОГИЕ ПРАВИЛА: ' +
      '(1) Если по конкретной модели данных нет — ПРОПУСТИ ключ, не ' +
      'угадывай. Лучше вернуть меньше полей, чем выдумать. ' +
      '(2) Если модель есть в общедоступных каталогах производителя — ' +
      'значение confidence >= 0.85. Если ты опираешься на типичное для ' +
      'подкласса значение (модели точно не знаешь) — confidence не выше ' +
      '0.6. Не завышай confidence. ' +
      '(3) valueRaw — только число или короткая строка без формул и ' +
      'диапазонов. Например "7.5", не "от 5 до 10". Для диапазона ' +
      'бери среднее или наиболее типовое. ' +
      '(4) unit — ровно в той форме, что попросили. Если у тебя другое ' +
      'значение в других единицах — пересчитай (кВт↔л.с., МПа↔бар). ' +
      '(5) В reason — явно указывай источник: «паспорт модели X», ' +
      '«каталог производителя Y», «типовое для подкласса». ' +
      'Возвращай ТОЛЬКО json {"items":[{"key":"...","valueRaw":"...","unit":"...","confidence":0.0-1.0,"reason":"..."}]}.';
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
      maxTokens: 800,
      isEmpty: (v) => {
        const items = (v as Out | undefined)?.items;
        return !items || items.length === 0;
      },
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

  async enrichBomFromWeb(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
    actions: Array<{ id: string; name: string }>;
    mode: 'bom' | 'apl';
  }) {
    const code = input.model.normalizedCode || input.model.rawCode || '';
    // 1) Если для класса/подкласса есть реальный BOM из паспорта — отдаём
    //    его без обращения к ИИ. Источник ровно тот же, что в xlsx.
    const realKey = `${input.model.className ?? ''}/${input.model.subclassName ?? ''}`;
    const real = BOM_BY_CLASS[realKey];
    if (real) {
      return real.items.slice(0, 40).map((x) => ({
        actionId: undefined,
        actionName: undefined,
        tmcName: x.designation ? `${x.name} (${x.designation})` : x.name,
        // В BOM из паспорта «материал/запчасть» не разделено — всё идёт
        // как запчасть; для APL-режима фильтр ниже не нужен (это spare).
        tmcKind: 'spare' as const,
        tmcUnit: x.unit ?? undefined,
        tmcQty: typeof x.qty === 'number' ? x.qty : undefined,
        confidence: 1,
        reason: x.source ?? 'Из паспорта модели',
      }));
    }
    const cacheKey =
      'enrichBom:' +
      fingerprint(
        code,
        input.model.className,
        input.model.subclassName,
        input.mode,
        input.actions.map((a) => a.name),
      );
    const modeText =
      input.mode === 'bom'
        ? 'BOM (Bill of Materials) — полный перечень ТМЦ для ТОиР: материалы (расходники: масла, смазки, прокладки, уплотнения, фильтры) + запасные части (подшипники, валы, рабочие колёса).'
        : 'APL (Application Parts List) — перечень запасных частей для ВВ ТОиР, БЕЗ расходных материалов. Только запчасти (подшипники, рабочие колёса, валы, торцевые уплотнения, муфты).';
    const system =
      'Ты инженер-эксперт по ТОиР промышленного оборудования и типовым ' +
      'перечням ТМЦ. На основании общедоступных каталогов запчастей и ' +
      `руководств по эксплуатации ты формируешь ${modeText} ` +
      'СТРОГИЕ ПРАВИЛА: ' +
      '(1) Не придумывай экзотических деталей — перечисляй только ' +
      'компоненты, которые гарантированно входят в конструкцию ' +
      'оборудования данного подкласса (как в паспорте / спецификации). ' +
      '(2) Если в наименовании можно указать обозначение (стандартное ' +
      'обозначение подшипника «6204», класс болта «М12×50», марку ' +
      'уплотнения) — указывай, но не выдумывай артикулы производителя. ' +
      '(3) Единицы измерения — только «шт», «кг», «л», «м», «компл». ' +
      '(4) Количество — целое или с одним знаком после запятой. ' +
      '(5) Если у тебя нет уверенности в позиции — не включай её. ' +
      'Минимум 8 позиций для BOM, 5 для APL — но все должны быть ' +
      'реалистичными. ' +
      'Привязывай позиции к ВВ по actionId из переданного списка. ' +
      'Возвращай ТОЛЬКО json вида ' +
      '{"items":[{"actionId":"id","tmcName":"Подшипник 6204 (ГОСТ 8338)","tmcKind":"material|spare","tmcUnit":"шт","tmcQty":2,"confidence":0.8,"reason":"стандартная опора вала"}]}. ' +
      (input.mode === 'apl'
        ? 'tmcKind должен быть только "spare". '
        : '') +
      'confidence: 0.9+ если позиция точно есть в любой модификации ' +
      'подкласса, 0.6-0.8 если зависит от исполнения, 0.3-0.5 если ' +
      'догадка. Никогда не возвращай пустой items.';
    const sample = bomFewShot(input.model.className, input.model.subclassName, 10);
    const user = `Модель: ${code}
Класс: ${input.model.className ?? '—'}
Подкласс: ${input.model.subclassName ?? '—'}
Список ВВ (JSON): ${JSON.stringify(input.actions)}
Режим: ${input.mode.toUpperCase()}
${sample ? '\n' + sample + '\n\nИспользуй этот пример как образец стиля и детализации.\n' : ''}
Сформируй типовой перечень ТМЦ, опираясь на класс «${input.model.className ?? '—'}» / подкласс «${input.model.subclassName ?? '—'}». Если модель точно неизвестна — всё равно перечисли стандартные для подкласса позиции.`;
    type Out = {
      items?: Array<{
        actionId?: string;
        tmcName: string;
        tmcKind: 'material' | 'spare';
        tmcUnit?: string;
        tmcQty?: number;
        confidence?: number;
        reason?: string;
      }>;
    };
    const result = await callOpenAI<Out>(cacheKey, {
      system,
      user,
      maxTokens: 2500,
      model: 'quality',
      isEmpty: (v) => {
        const items = (v as Out | undefined)?.items;
        return !items || items.length === 0;
      },
    });
    if (!result?.items) return [];
    const validActionIds = new Set(input.actions.map((a) => a.id));
    return result.items
      .filter((x) => x.tmcName && (x.tmcKind === 'material' || x.tmcKind === 'spare'))
      .filter((x) => input.mode === 'bom' || x.tmcKind === 'spare')
      .map((x) => ({
        actionId:
          x.actionId && validActionIds.has(x.actionId) ? x.actionId : undefined,
        actionName: input.actions.find((a) => a.id === x.actionId)?.name,
        tmcName: x.tmcName,
        tmcKind: x.tmcKind,
        tmcUnit: x.tmcUnit,
        tmcQty: typeof x.tmcQty === 'number' ? x.tmcQty : undefined,
        confidence:
          typeof x.confidence === 'number' ? x.confidence : undefined,
        reason: x.reason,
      }))
      .slice(0, 30);
  },

  async fillTechCardByTemplate(input) {
    const code = input.model.normalizedCode || input.model.rawCode || '';
    const cacheKey =
      'techCard:' +
      fingerprint(
        code,
        input.model.className,
        input.model.subclassName,
        input.actions.map((a) => a.name),
      );
    // Справочники выдаём коротко — иначе съедим весь лимит токенов.
    const opList = (input.operations ?? [])
      .slice(0, 100)
      .map((o) => `"${o}"`)
      .join(',');
    const specList = (input.specialties ?? [])
      .slice(0, 40)
      .map(
        (s) => `{"name":"${s.name}","qual":${JSON.stringify(s.qualifications.slice(0, 4))}}`,
      )
      .join(',');
    const system =
      'Ты инженер-эксперт по ТОиР промышленного оборудования. Формируешь ' +
      'техкарту по шаблону «Простоев.Нет». Каждая строка = одна операция ' +
      'для одного подэлемента конкретного ВВ. ' +
      'СТРОГИЕ ПРАВИЛА: ' +
      '(1) Элемент (component) и Подэлемент (subcomponent) должны быть ' +
      'реальными узлами для данного класса/подкласса (как в паспорте). ' +
      'Не выдумывай узлы, которых у оборудования этого типа не бывает. ' +
      '(2) Операция — из справочника (Демонтаж, Монтаж, Осмотр, ' +
      'Смазка, Замена, Регулировка, Диагностика, Чистка, Проверка). ' +
      '(3) workDescription — 1-2 короткие фразы без воды, как в паспорте. ' +
      '(4) laborHours — реалистично: осмотр 0.5-2 ч, демонтаж 1-8 ч, ' +
      'замена подшипника 4-16 ч, регулировка 0.5-4 ч, капремонт 40-200 ч. ' +
      '(5) workers — 1 для простых, 2 для подъёма, 3+ для крупногабаритных. ' +
      '(6) totalLaborHours = laborHours × workers. ' +
      '(7) specialty + qualification из справочника ("Слесарь по ремонту ' +
      'оборудования, 4 разряд", "Электромонтёр, 5 разряд", ' +
      '"Машинист крана, 5 разряд"). ' +
      '(8) ТМЦ (tmcName) только если реально расходуется в операции: ' +
      'смазка/масло (л, кг), прокладки (шт), подшипники при замене (шт). ' +
      'Инструменты в ТМЦ НЕ включаются — они идут в tools. ' +
      '(9) tools — через точку с запятой: "Набор ключей, 1 компл; ' +
      'Динамометрический ключ, 1 шт". ' +
      '(10) ppe — конкретно: "Каска, 1 шт; Очки защитные, 1 шт; ' +
      'Перчатки, 1 пара". ' +
      '(11) safety — 2-3 пункта через точку с запятой, конкретно по ' +
      'операции (отключить питание, вывесить табличку, установить ' +
      'ограждение). ' +
      '(12) Каждое ВВ покрыто 2–5 строками разных операций. ' +
      '(13) Если у тебя нет уверенности в параметре — не включай строку. ' +
      'Минимум 10 реалистичных строк. ' +
      'Возвращай ТОЛЬКО json: {"rows":[ {...} ]} c полями: actionId, ' +
      'component, subcomponent, operation, workDescription, laborHours, ' +
      'workers, specialty, qualification, totalLaborHours, tmcName, ' +
      'tmcKind (material|spare), tmcUnit, tmcQty, tools, ppe, safety, ' +
      'confidence.';
    const fewShot = techCardFewShot(3);
    const user = `Модель: ${code}
Класс: ${input.model.className ?? '—'}
Подкласс: ${input.model.subclassName ?? '—'}
ВВ (JSON): ${JSON.stringify(input.actions)}
Справочник операций (выбирай из них): [${opList}]
Справочник специальностей: [${specList}]

${fewShot ? 'Эталон оформления (реальные строки из шаблона Простоев.Нет):\n\n' + fewShot + '\n\n' : ''}Сформируй типовую техкарту по шаблону, покрывая все ВВ. Пиши в том же стиле и с той же детализацией, что в эталоне.`;
    type Row = {
      actionId?: string;
      component?: string;
      subcomponent?: string;
      operation?: string;
      workDescription?: string;
      laborHours?: number;
      workers?: number;
      specialty?: string;
      qualification?: string;
      totalLaborHours?: number;
      tmcName?: string;
      tmcKind?: 'material' | 'spare';
      tmcUnit?: string;
      tmcQty?: number;
      tools?: string;
      ppe?: string;
      safety?: string;
      confidence?: number;
    };
    type Out = { rows?: Row[] };
    const result = await callOpenAI<Out>(cacheKey, {
      system,
      user,
      maxTokens: 4000,
      model: 'quality',
      isEmpty: (v) => {
        const rows = (v as Out | undefined)?.rows;
        return !rows || rows.length === 0;
      },
    });
    if (!result?.rows) return [];
    const validActionIds = new Set(input.actions.map((a) => a.id));
    return result.rows
      .filter((x) => x.operation || x.component)
      .map((x) => ({
        actionId:
          x.actionId && validActionIds.has(x.actionId) ? x.actionId : undefined,
        component: x.component,
        subcomponent: x.subcomponent,
        operation: x.operation,
        workDescription: x.workDescription,
        laborHours:
          typeof x.laborHours === 'number' ? x.laborHours : undefined,
        workers: typeof x.workers === 'number' ? x.workers : undefined,
        specialty: x.specialty,
        qualification: x.qualification,
        totalLaborHours:
          typeof x.totalLaborHours === 'number' ? x.totalLaborHours : undefined,
        tmcName: x.tmcName?.trim() ? x.tmcName.trim() : undefined,
        tmcKind:
          x.tmcKind === 'material' || x.tmcKind === 'spare'
            ? x.tmcKind
            : undefined,
        tmcUnit: x.tmcUnit,
        tmcQty: typeof x.tmcQty === 'number' ? x.tmcQty : undefined,
        tools: x.tools,
        ppe: x.ppe,
        safety: x.safety,
        confidence:
          typeof x.confidence === 'number' ? x.confidence : undefined,
      }))
      .slice(0, 60);
  },
};
