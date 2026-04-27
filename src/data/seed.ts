import type {
  Classifier,
  EquipmentModel,
  HierarchyNode,
  NormalizationRules,
} from '../domain/types';

/**
 * Классификатор «Простоев.Нет» по умолчанию — минимальный набор классов
 * промышленного оборудования с приоритетными характеристиками и ключевыми
 * словами для автоклассификации (п.6.1 ТЗ: «По умолчанию в инструменте
 * загружен и используется Классификатор и Правила нормализации Простоев.Нет»).
 *
 * Пользователь может перезаписать его, загрузив свой xlsx через
 * «Загрузить» — autoImport заменит список classes целиком.
 */
export const SEED_CLASSIFIER: Classifier = {
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
 * По умолчанию иерархия пустая — пользователь загружает её из xlsx.
 * Корень — единственный узел с подсказкой; модели появляются после загрузки.
 */
export function buildSeedHierarchy(): {
  hierarchy: HierarchyNode;
  models: EquipmentModel[];
} {
  const hierarchy: HierarchyNode = {
    id: 'root',
    type: 'enterprise',
    name: 'Иерархия',
    description:
      'Нажмите «Загрузить» и выберите файлы (иерархия, классификатор, сопоставления, ВВ). Тип определяется автоматически по колонкам.',
    children: [],
  };
  return { hierarchy, models: [] };
}
