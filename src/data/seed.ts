import type {
  Classifier,
  EquipmentModel,
  HierarchyNode,
  NodeType,
  NormalizationRules,
} from '../domain/types';
import { normalizeModelCode } from '../domain/normalize';
import {
  PROSTOEV_CLASSIFIER,
  SEVERAL_HIERARCHY_ROWS,
  SEVERAL_CLASSIFICATION,
} from './prostoev';

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
 * Модели сразу нормализованы по п.8.3 ТЗ и прокласифицированы по привязкам
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
      const m: EquipmentModel = {
        id: seedId('m'),
        nodeId: parent.id,
        rawCode: row.model,
        normalizedCode: norm.code,
        className: cls?.className,
        subclassName: cls?.subclassName,
        classificationSource: cls ? 'classifier' : undefined,
        classificationConfidence: cls ? 1 : undefined,
      };
      parent.modelIds = (parent.modelIds ?? []).concat(m.id);
      models.push(m);
    }
  }

  return { hierarchy: root, models };
}

export const LEGACY_MINIMAL_CLASSIFIER: Classifier = _LEGACY_SEED;
