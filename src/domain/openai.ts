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
    /** Если true — игнорировать кэш и перезаписать его. */
    bypassCache?: boolean;
    /** Если задано — не кэшировать, когда функция вернула «пусто». */
    isEmpty?: (value: unknown) => boolean;
  },
): Promise<T | undefined> {
  const cache = readCache();
  if (!body.bypassCache && cache[cacheKey]) {
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

  async enrichBomFromWeb(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
    actions: Array<{ id: string; name: string }>;
    mode: 'bom' | 'apl';
  }) {
    const code = input.model.normalizedCode || input.model.rawCode || '';
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
      'Для класса/подкласса всегда есть типовой перечень — даже если точная ' +
      'модификация неизвестна, перечисли стандартные позиции класса с ' +
      'confidence 0.5-0.7. Минимум 8 позиций для BOM, 5 для APL. ' +
      'Привязывай позиции к ВВ из переданного списка по id (actionId). ' +
      'Возвращай ТОЛЬКО json вида ' +
      '{"items":[{"actionId":"id-из-списка-или-пусто","tmcName":"Подшипник 6204","tmcKind":"material|spare","tmcUnit":"шт|кг|л|м","tmcQty":1,"confidence":0.7,"reason":"кратко"}]}. ' +
      (input.mode === 'apl'
        ? 'tmcKind должен быть только "spare" (без материалов). '
        : '') +
      'confidence: 0.9 если позиция стандартная для класса, 0.6-0.8 если ' +
      'зависит от модификации, 0.4-0.5 — общая оценка. Никогда не возвращай ' +
      'пустой items: всегда есть типовые расходники/запчасти.';
    const user = `Модель: ${code}
Класс: ${input.model.className ?? '—'}
Подкласс: ${input.model.subclassName ?? '—'}
Список ВВ (JSON): ${JSON.stringify(input.actions)}
Режим: ${input.mode.toUpperCase()}

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
      'техкарту по шаблону «Простоев.Нет» (Элемент → Подэлемент → ' +
      'Наименование операции → Вид ТОиР → Норма времени → Количество ' +
      'исполнителей → Профессия/Квалификация → ТМЦ). Каждое ВВ из ' +
      'переданного списка должно быть покрыто 2–6 строками (разные ' +
      'компоненты / операции). Используй наименования операций и профессий ' +
      'ИЗ предоставленных справочников, если они там есть. Не выдумывай ' +
      'экзотику — выбирай стандартные операции (Демонтаж, Монтаж, ' +
      'Проверка, Смазка, Замена, Диагностика, Регулировка). Возвращай ' +
      'ТОЛЬКО json вида ' +
      '{"rows":[{' +
      '"actionId":"id-из-списка-ВВ",' +
      '"component":"Ходовая часть",' +
      '"subcomponent":"Колесо",' +
      '"operation":"Демонтаж",' +
      '"workDescription":"Снять компонент с креплений",' +
      '"laborHours":4,' +
      '"workers":2,' +
      '"specialty":"Слесарь по ремонту оборудования",' +
      '"qualification":"4 разряд",' +
      '"totalLaborHours":8,' +
      '"tmcName":"",' +
      '"tmcKind":"material|spare",' +
      '"tmcUnit":"шт|кг|л",' +
      '"tmcQty":1,' +
      '"tools":"Набор ключей гаечных, 1 компл",' +
      '"ppe":"Каска, очки, перчатки",' +
      '"safety":"Отключить питание, вывесить табличку",' +
      '"confidence":0.7' +
      '}]}. ' +
      'Если ТМЦ для строки не требуется — оставь tmcName пустым. ' +
      'totalLaborHours = laborHours × workers. Минимум 10 строк.';
    const user = `Модель: ${code}
Класс: ${input.model.className ?? '—'}
Подкласс: ${input.model.subclassName ?? '—'}
ВВ (JSON): ${JSON.stringify(input.actions)}
Справочник операций (выбирай из них): [${opList}]
Справочник специальностей: [${specList}]

Сформируй типовую техкарту по шаблону, покрывая все ВВ.`;
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
