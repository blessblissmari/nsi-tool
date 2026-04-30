import type {
  ActionItem,
  Characteristic,
  Classifier,
  EquipmentModel,
  HierarchyNode,
  NodeType,
  NormalizationRules,
  ReferenceData,
} from '../domain/types';
import { normalizeModelCode } from '../domain/normalize';
import {
  PROSTOEV_CLASSIFIER,
  SEVERAL_HIERARCHY_ROWS,
  SEVERAL_CLASSIFICATION,
} from './prostoev';
import {
  PROSTOEV_ACTIONS_BY_MODEL,
  PROSTOEV_CHARS_BY_MODEL,
  PROSTOEV_REFERENCES,
} from './prostoevRefs';
import seedModelsFullCharsJson from './seedModelsFullChars.json';

interface SeedFullCharsRow {
  className: string | null;
  subclassName: string | null;
  code: string;
  chars: Array<{ key: string; value: string; unit: string | null }>;
}
const SEED_FULL_CHARS = seedModelsFullCharsJson as SeedFullCharsRow[];

/** Справочники «Простоев.Нет» по умолчанию. */
export const SEED_REFERENCES: ReferenceData = PROSTOEV_REFERENCES;

function mapVvKind(name: string): ActionItem['kind'] {
  const s = name.toUpperCase();
  if (s.startsWith('ТО')) return 'TO';
  if (s.startsWith('ТР') || s.startsWith('КР')) return 'repair';
  if (s.includes('ДИАГН')) return 'diagnostic';
  if (s.includes('ОСМОТР') || s.includes('ПОВЕР')) return 'inspection';
  return 'other';
}

/**
 * Классификатор «Простоев.Нет» по умолчанию — полный справочник из
 * «Классификатор.xlsx» (12 классов, 20 подклассов, приоритетные
 * характеристики). Ключевые слова к классам/подклассам добавлены
 * автоматически на основе названия.
 *
 * Пользователь может перезаписать его, загрузив свой xlsx через
 * «Загрузить» — autoImport заменит список classes целиком.
 */
export const SEED_CLASSIFIER: Classifier = PROSTOEV_CLASSIFIER;

/** Внутренний (на время миграции) — старый минимальный демо-классификатор,
 *  не используется как default, но оставлен как пример. */
const _LEGACY_SEED: Classifier = {
  classes: [
    {
      name: 'Насосы',
      keywords: ['насос', 'pump'],
      priorityChars: [
        { key: 'Подача', unit: 'м3/ч', type: 'number', aliases: ['производительность', 'расход'] },
        { key: 'Напор', unit: 'м', type: 'number' },
        { key: 'Мощность', unit: 'кВт', type: 'number' },
      ],
      subclasses: [
        { name: 'Центробежные', keywords: ['центробеж', 'нм', 'nm', 'к-', 'км-', 'кмс', 'kms', 'km-'] },
        { name: 'Шестерёнчатые', keywords: ['шестер', 'нш', 'nsh', 'gear'] },
        { name: 'Винтовые', keywords: ['винтов', 'screw'] },
        { name: 'Поршневые', keywords: ['поршн', 'piston'] },
        { name: 'Мембранные', keywords: ['мембр', 'диафраг'] },
      ],
    },
    {
      name: 'Двигатели',
      keywords: ['двигател', 'мотор', 'motor', 'аир', 'аим'],
      priorityChars: [
        { key: 'Мощность', unit: 'кВт', type: 'number' },
        { key: 'Напряжение', unit: 'В', type: 'number' },
        { key: 'Частота вращения', unit: 'об/мин', type: 'number', aliases: ['обороты', 'rpm'] },
      ],
      subclasses: [
        { name: 'Асинхронные', keywords: ['асинхрон', 'аир', 'air', 'ад', 'аим', 'aim', '4а', '4a'] },
        { name: 'Постоянного тока', keywords: ['постоянного тока', 'дпт', 'dc'] },
        { name: 'Синхронные', keywords: ['синхрон', 'sd'] },
      ],
    },
    {
      name: 'Компрессоры',
      keywords: ['компрессор', 'compressor'],
      priorityChars: [
        { key: 'Производительность', unit: 'м3/мин', type: 'number' },
        { key: 'Давление', unit: 'МПа', type: 'number' },
        { key: 'Мощность', unit: 'кВт', type: 'number' },
      ],
      subclasses: [
        { name: 'Поршневые', keywords: ['поршн'] },
        { name: 'Винтовые', keywords: ['винтов', 'screw'] },
        { name: 'Центробежные', keywords: ['центробеж'] },
      ],
    },
    {
      name: 'Редукторы',
      keywords: ['редуктор', 'reducer'],
      priorityChars: [
        { key: 'Передаточное число', type: 'number' },
        { key: 'Крутящий момент', unit: 'Н*м', type: 'number' },
      ],
      subclasses: [
        { name: 'Цилиндрические', keywords: ['цилиндр', 'ц2', 'ц3', 'c2', 'c3'] },
        { name: 'Червячные', keywords: ['червяч'] },
        { name: 'Планетарные', keywords: ['планетар'] },
      ],
    },
    {
      name: 'Вентиляторы',
      keywords: ['вентилятор', 'fan', 'вц-', 'во-', 'vc-', 'vo-'],
      priorityChars: [
        { key: 'Производительность', unit: 'м3/ч', type: 'number' },
        { key: 'Напор', unit: 'Па', type: 'number' },
      ],
      subclasses: [
        { name: 'Осевые', keywords: ['осев', 'во-'] },
        { name: 'Радиальные', keywords: ['радиальн', 'вц-', 'центробеж'] },
        { name: 'Канальные', keywords: ['канальн'] },
      ],
    },
    {
      name: 'Ёмкости',
      keywords: ['емкост', 'ёмкост', 'резервуар', 'цистерн', 'бак'],
      priorityChars: [
        { key: 'Объём', unit: 'м3', type: 'number' },
        { key: 'Давление', unit: 'МПа', type: 'number' },
      ],
      subclasses: [
        { name: 'Резервуары', keywords: ['резервуар', 'рвс', 'rvs'] },
        { name: 'Цистерны', keywords: ['цистерн'] },
        { name: 'Баки', keywords: ['бак'] },
      ],
    },
    {
      name: 'Теплообменники',
      keywords: ['теплообмен', 'heat exchanger'],
      priorityChars: [
        { key: 'Поверхность теплообмена', unit: 'м2', type: 'number' },
        { key: 'Давление', unit: 'МПа', type: 'number' },
      ],
      subclasses: [
        { name: 'Кожухотрубные', keywords: ['кожух', 'трубчат'] },
        { name: 'Пластинчатые', keywords: ['пластинч'] },
      ],
    },
    {
      name: 'Запорная арматура',
      keywords: ['задвижк', 'клапан', 'кран', 'вентил'],
      priorityChars: [
        { key: 'DN', unit: 'мм', type: 'number', aliases: ['диаметр', 'ду'] },
        { key: 'PN', unit: 'МПа', type: 'number', aliases: ['давление'] },
      ],
      subclasses: [
        { name: 'Задвижки', keywords: ['задвижк', '30с', '30ч', '30c'] },
        { name: 'Клапаны', keywords: ['клапан'] },
        { name: 'Краны', keywords: ['кран ', 'шаров'] },
      ],
    },
    {
      name: 'Трубопроводы',
      keywords: ['трубопровод', 'pipeline'],
      priorityChars: [
        { key: 'DN', unit: 'мм', type: 'number' },
        { key: 'PN', unit: 'МПа', type: 'number' },
      ],
      subclasses: [
        { name: 'Магистральные', keywords: ['магистрал'] },
        { name: 'Технологические', keywords: ['технологич'] },
      ],
    },
    {
      name: 'Электрические щиты',
      keywords: ['щит', 'шкаф', 'панель'],
      priorityChars: [
        { key: 'Напряжение', unit: 'В', type: 'number' },
        { key: 'Ток', unit: 'А', type: 'number' },
      ],
      subclasses: [
        { name: 'Силовые', keywords: ['силов'] },
        { name: 'Управления', keywords: ['управлен'] },
        { name: 'Распределительные', keywords: ['распред'] },
      ],
    },
  ],
};

export const SEED_NORMALIZATION_RULES: NormalizationRules = {
  modelRules: [
    { id: 'p1', description: 'Все буквы — в верхнем регистре', enabled: true },
    {
      id: 'p2',
      description: 'Удалить пробелы, двойные пробелы, непечатные символы',
      enabled: true,
    },
    {
      id: 'p3',
      description: 'Между буквами и цифрами удалить все знаки',
      enabled: true,
    },
    { id: 'p4', description: 'Разделители между буквами → дефис', enabled: true },
    { id: 'p5', description: 'Точка между цифрами сохраняется', enabled: true },
    { id: 'p6', description: 'Запятая между цифрами → точка', enabled: true },
    { id: 'p7', description: '«№<цифры>» → в скобках в конце кода', enabled: true },
    { id: 'p8', description: 'Латинская «x» как разделитель → дефис', enabled: true },
    { id: 'p9', description: 'Запрет «ё»/«Ё» (заменяется на «е»/«Е»)', enabled: true },
    {
      id: 'p10',
      description: 'Латиница-омоглифы (А,В,С,Е,Н,К,М,О,Р,Т,Х) → кириллица',
      enabled: true,
    },
    { id: 'p11', description: 'Арабские цифры разрешены', enabled: true },
    { id: 'p12', description: 'Римские цифры разрешены', enabled: true },
    { id: 'p13', description: 'Допустимые спецсимволы: . - № ( )', enabled: true },
  ],
  classRules: [
    { id: 'c1', description: 'Запись с заглавной буквы', enabled: true },
    {
      id: 'c2',
      description: 'Именительный падеж, множественное число',
      enabled: true,
    },
    {
      id: 'c3',
      description: 'Если слов >1 — первое существительное',
      enabled: true,
    },
    { id: 'c5', description: 'Без двойных пробелов и непечатных', enabled: true },
    {
      id: 'c6',
      description: 'Только кириллица (без «ё»/«Ё»)',
      enabled: true,
    },
    { id: 'c7', description: 'Из спецсимволов только дефис', enabled: true },
  ],
};

/**
 * Seed — демо-иерархия «Северал» из бандлированного «Иерархия с моделями.xlsx»
 * (предприятие → ВС → цех → участок → линия → агрегат → ТОР; 7 уровней, 29 моделей).
 * Модели сразу нормализованы по п.8.3 и прокласифицированы по привязкам
 * из «Классификация моделей.xlsx».
 *
 * Если пользователь загрузит свой xlsx через «Загрузить», `setHierarchy`
 * в сторе заменит всё целиком.
 */
const LEVEL_TYPE: NodeType[] = [
  'enterprise',
  'plant',
  'workshop',
  'site',
  'group',
  'group',
  'group',
];

const LEVEL_LABEL: string[] = [
  'Предприятие',
  'Подразделение',
  'Цех',
  'Участок',
  'Линия',
  'Агрегат',
  'Узел',
];

let seedCounter = 0;
const seedId = (p: string) =>
  `seed-${p}-${++seedCounter}`;

export function buildSeedHierarchy(): {
  hierarchy: HierarchyNode;
  models: EquipmentModel[];
} {
  const classByCode = new Map<
    string,
    { className: string; subclassName?: string }
  >();
  for (const c of SEVERAL_CLASSIFICATION) {
    classByCode.set(c.model, {
      className: c.class,
      subclassName: c.subclass || undefined,
    });
  }
  // Истор. ВВ на каждую модель из «Виды воздействия на ТОР ист.xlsx».
  const actionsByCode = new Map<string, ActionItem[]>();
  for (const row of PROSTOEV_ACTIONS_BY_MODEL) {
    const list: ActionItem[] = row.actions.map((a, i) => ({
      id: `${row.model}-vv-${i + 1}`,
      name: a.name,
      kind: mapVvKind(a.name),
      periodHours: a.periodHours ?? undefined,
      source: 'document' as const,
      note: 'Из истории эксплуатации',
    }));
    actionsByCode.set(row.model, list);
  }
  // Полные характеристики на каждую модель из «Результирующий файл Модели с
  // характ. ист. полный.xlsx» (5–21 хар-к на модель). Приоритет берём из
  // классификатора Простоев.Нет.
  const charsByCode = new Map<string, Characteristic[]>();
  // Сначала индекс приоритетных ключей по классу/подклассу — для пометки
  // isPriority/priorityOrder.
  const priorityIndex = new Map<string, Map<string, number>>();
  for (const cls of PROSTOEV_CLASSIFIER.classes) {
    const map = new Map<string, number>();
    cls.priorityChars?.forEach((p, i) => map.set(p.key.toLowerCase(), i));
    for (const sub of cls.subclasses) {
      sub.priorityChars?.forEach((p, i) => {
        if (!map.has(p.key.toLowerCase())) map.set(p.key.toLowerCase(), i + 100);
      });
    }
    priorityIndex.set(cls.name, map);
  }
  for (const row of SEED_FULL_CHARS) {
    const pri = row.className ? priorityIndex.get(row.className) : undefined;
    const list: Characteristic[] = row.chars.map((c, i) => {
      const pIdx = pri?.get(c.key.toLowerCase());
      const num = Number(String(c.value).replace(',', '.'));
      return {
        id: `${row.code}-ch-${i + 1}`,
        key: c.key,
        valueRaw: String(c.value),
        valueNum: Number.isFinite(num) ? num : undefined,
        unit: c.unit ?? undefined,
        targetUnit: c.unit ?? undefined,
        isPriority: pIdx !== undefined,
        priorityOrder: pIdx,
        source: 'document' as const,
      };
    });
    charsByCode.set(row.code, list);
  }
  // Дополним моделями, у которых в «полном» файле нет записи — берём из
  // приоритетного источника (для совместимости).
  for (const row of PROSTOEV_CHARS_BY_MODEL) {
    if (charsByCode.has(row.model)) continue;
    const list: Characteristic[] = row.chars.map((c, i) => ({
      id: `${row.model}-ch-${i + 1}`,
      key: c.key,
      valueRaw: String(c.value),
      valueNum: typeof c.value === 'number' ? c.value : undefined,
      unit: c.unit ?? undefined,
      targetUnit: c.unit ?? undefined,
      isPriority: true,
      priorityOrder: c.order,
      source: 'document' as const,
    }));
    charsByCode.set(row.model, list);
  }

  const root: HierarchyNode = {
    id: seedId('root'),
    type: 'enterprise',
    name: '',
    levelLabel: LEVEL_LABEL[0],
    children: [],
  };

  // ключ для дедупликации узла по пути
  const cache = new Map<string, HierarchyNode>();
  const models: EquipmentModel[] = [];

  for (const row of SEVERAL_HIERARCHY_ROWS) {
    const path = row.path.filter((x) => x && x.trim());
    if (!path.length && !row.model) continue;

    // Корень — первый уровень. Если ещё не задан — берём имя из первой строки.
    if (path.length > 0 && !root.name) {
      root.name = path[0];
    }

    let parent = root;
    for (let i = 1; i < path.length; i++) {
      const segKey = path.slice(0, i + 1).join('\u0001');
      let node = cache.get(segKey);
      if (!node) {
        node = {
          id: seedId('n'),
          type: LEVEL_TYPE[i] ?? 'group',
          name: path[i],
          levelLabel: LEVEL_LABEL[i] ?? `Уровень ${i + 1}`,
          children: [],
        };
        parent.children.push(node);
        cache.set(segKey, node);
      }
      parent = node;
    }

    if (row.model) {
      const norm = normalizeModelCode(row.model);
      const cls = classByCode.get(norm.code);
      const acts = actionsByCode.get(norm.code);
      const chars = charsByCode.get(norm.code);
      const m: EquipmentModel = {
        id: seedId('m'),
        nodeId: parent.id,
        rawCode: row.model,
        normalizedCode: norm.code,
        className: cls?.className,
        subclassName: cls?.subclassName,
        classificationSource: cls ? 'classifier' : undefined,
        classificationConfidence: cls ? 1 : undefined,
        actions: acts ? acts.map((a) => ({ ...a })) : undefined,
        characteristics: chars ? chars.map((c) => ({ ...c })) : undefined,
      };
      parent.modelIds = (parent.modelIds ?? []).concat(m.id);
      models.push(m);
    }
  }

  return { hierarchy: root, models };
}

export const LEGACY_MINIMAL_CLASSIFIER: Classifier = _LEGACY_SEED;
