import type {
  Classifier,
  EquipmentModel,
  HierarchyNode,
  NormalizationRules,
} from '../domain/types';

/**
 * Классификатор по умолчанию пустой — пользователь загружает «Классификатор.xlsx»
 * (Класс / Подкласс / Характеристика 1 / Ед.измерения 1 / … / Хар-ка 5 / Ед.изм 5).
 */
export const SEED_CLASSIFIER: Classifier = { classes: [] };

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
