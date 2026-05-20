export type NodeType =
  | 'enterprise'
  | 'plant'
  | 'workshop'
  | 'site'
  | 'group'
  | 'equipment';

export interface HierarchyNode {
  id: string;
  type: NodeType;
  name: string;
  /** Метка уровня из xlsx («Цех», «Участок», «Уровень 5» и т.п.). */
  levelLabel?: string;
  description?: string;
  attributes?: Record<string, string>;
  children: HierarchyNode[];
  /** Models attached to this node (only for `equipment` / `group`). */
  modelIds?: string[];
}

export interface EquipmentModel {
  id: string;
  /** Раздел иерархии, к которому привязана модель. */
  nodeId: string;
  /** Сырое значение, как пришло от заказчика. */
  rawCode: string;
  /** Результат нормализации по правилам п.8.3 ТЗ. */
  normalizedCode?: string;
  /** Класс по классификатору. */
  className?: string;
  /** Подкласс по классификатору. */
  subclassName?: string;
  /** Источник классификации. */
  classificationSource?: 'classifier' | 'manual' | 'ai' | 'unresolved';
  /** Уверенность последней авто-классификации (0..1). */
  classificationConfidence?: number;
  /** Подсказки кандидатов класса/подкласса (от классификатора, эвристик, ИИ). */
  classificationProposals?: ClassificationProposal[];
  /** Документы (только ссылки/метаданные — содержимое не хранится). */
  documents?: DocumentRef[];
  /** Извлечённые/введённые характеристики. */
  characteristics?: Characteristic[];
  /** Виды воздействия (ТО/ремонт/диагностика). */
  actions?: ActionItem[];
  /** Строки техкарты (Компонент / Операция / Профессия / ТМЦ). */
  techCard?: TechCardRow[];
  /** История отказов (для расчёта надёжности). */
  failures?: FailureRecord[];
  /** Картинка модели — URL или data:URI. Опционально, скрывается в настройках. */
  imageUrl?: string;
  /** Оценка качества данных. */
  validity?: {
    expertVerified: boolean;
    confidence?: number;
    source?: string;
  };
}

/** Одна строка техкарты в табличной форме «Модель → Элемент → Подэлемент → Операция → ТМЦ». */
export interface TechCardRow {
  id: string;
  /** Компонент / узел / деталь модели (Элемент в шаблоне). */
  component?: string;
  /** Подэлемент (детализация компонента). */
  subcomponent?: string;
  /** Операция выполняется на сам агрегат (целиком, без указания элемента).
   *  Для таких строк колонки Элемент / Подэлемент в UI пустые. */
  isAggregate?: boolean;
  /** Операция ТОиР (свободная или из справочника). */
  operation?: string;
  /** Краткое содержание работ (раскрытие операции). */
  workDescription?: string;
  /** Привязка к ВВ (id ActionItem). */
  actionId?: string;
  /** Норма времени на операцию, часы (на одного исполнителя). */
  laborHours?: number;
  /** Минимальное количество исполнителей. */
  workers?: number;
  /** Профессия исполнителя. */
  specialty?: string;
  /** Квалификация (разряд). */
  qualification?: string;
  /** Суммарная трудоёмкость, чел/ч = laborHours × workers. */
  totalLaborHours?: number;
  /** ТМЦ — наименование (только материалы и запчасти, инструмент исключается). */
  tmcName?: string;
  /** Тип ТМЦ. */
  tmcKind?: 'material' | 'spare';
  /** Единица измерения ТМЦ. */
  tmcUnit?: string;
  /** Норма расхода ТМЦ на операцию. */
  tmcQty?: number;
  /** Инструменты и приспособления (в BOM/APL не попадают, п.6.6). */
  tools?: string;
  /** Средства индивидуальной защиты. */
  ppe?: string;
  /** Требования по безопасности. */
  safety?: string;
  source: SourceKind;
  note?: string;
  lockedByExpert?: boolean;
}

/** История отказа — основа для расчёта параметров надёжности. */
export interface FailureRecord {
  id: string;
  /** Дата отказа (ISO). */
  failedAt: string;
  /** Дата восстановления (ISO). */
  restoredAt?: string;
  /** Тип отказа / описание. */
  description?: string;
  /** Длительность простоя, часы (если задано напрямую). */
  downtimeHours?: number;
}

export type SourceKind =
  | 'document'
  | 'web'
  | 'analog'
  | 'manual'
  | 'classifier'
  | 'ai'
  | 'database';

/** Тип ВВ — вид воздействия (по справочнику: ТО, ТР, КР, диагностика, осмотр…). */
export type ActionKind = 'TO' | 'repair' | 'inspection' | 'diagnostic' | 'other';

export interface ActionItem {
  id: string;
  /** Название как в источнике: «ТО-1», «ТР-2», «КР-1»… */
  name: string;
  kind?: ActionKind;
  /** Периодичность в часах (как в Справочнике ВВ и периодичностей). */
  periodHours?: number;
  /** Источник: «ист» (история эксплуатации) / «инт» (интернет/справочник) / «document» / «manual» / «ai». */
  source: SourceKind;
  /** Произвольное описание/комментарий. */
  note?: string;
  /** Зафиксировано экспертом — не перезаписывается автоматикой. */
  lockedByExpert?: boolean;
}

/** Кандидат классификации модели — для UI «принять одним кликом». */
export interface ClassificationProposal {
  className: string;
  subclassName?: string;
  /** 0..1 — оценка уверенности. */
  confidence: number;
  /** Краткое объяснение почему предложен этот вариант. */
  reason: string;
  /** Источник предложения. */
  source: 'classifier' | 'heuristic' | 'ai';
}

export interface DocumentRef {
  id: string;
  url: string;
  kind: 'passport' | 'manual' | 'datasheet' | 'other';
  filename?: string;
  /** Распознанный текст (демо: вставленный экспертом). */
  parsedText?: string;
  parsedAt?: string;
}

export interface Characteristic {
  id: string;
  key: string;
  valueRaw: string;
  valueNum?: number;
  /** Целевая единица измерения (нормализованная). */
  unit?: string;
  /** Целевая единица из приоритетных характеристик класса/подкласса. */
  targetUnit?: string;
  isPriority: boolean;
  /** Порядок отображения для приоритетных характеристик. */
  priorityOrder?: number;
  source: SourceKind;
  /** Уверенность в значении (0..1). Показывается для источников web/ai. */
  confidence?: number;
  /** Документ, из которого извлечено (если применимо). */
  documentId?: string;
  /** Зафиксировано экспертом — не перезаписывается автоматикой. */
  lockedByExpert?: boolean;
}

/** Приоритетная характеристика класса/подкласса. */
export interface PriorityCharDef {
  /** Канонический ключ (то, что показываем). */
  key: string;
  /** Целевая единица измерения. */
  unit?: string;
  /** Тип значения. */
  type?: 'number' | 'enum' | 'text';
  /** Возможные написания ключа в документах для матчинга. */
  aliases?: string[];
}

export interface SubclassDef {
  name: string;
  /** Ключевые слова для классификации по сырому/нормализованному коду. */
  keywords?: string[];
  /** Регулярные выражения, помогающие распознать подкласс по коду модели. */
  patterns?: string[];
  /** Приоритетные характеристики (переопределение/дополнение к классу). */
  priorityChars?: PriorityCharDef[];
}

export interface ClassDef {
  name: string;
  subclasses: SubclassDef[];
  /** Ключевые слова для класса в целом (на случай несовпадения подклассов). */
  keywords?: string[];
  /** Приоритетные характеристики класса. */
  priorityChars?: PriorityCharDef[];
}

export interface Classifier {
  classes: ClassDef[];
}

export interface NormalizationRule {
  id: string;
  description: string;
  enabled: boolean;
}

export interface NormalizationRules {
  /** п.8.3 ТЗ — наименования моделей. */
  modelRules: NormalizationRule[];
  /** п.8.2 ТЗ — наименования классов и подклассов. */
  classRules: NormalizationRule[];
}

/** Загружаемые справочники общего назначения (используются для autocomplete и нормализации). */
export interface ReferenceData {
  /** Справочник ВВ и периодичностей. */
  actions: Array<{ name: string; periodHours: number }>;
  /** Справочник операций ТОиР (468 названий + 34 стандартных). */
  operations: Array<{ name: string; standard?: boolean }>;
  /** Справочник специальностей и квалификаций. */
  specialties: Array<{ name: string; qualifications: string[] }>;
  /** Справочник единиц измерения и физических величин (ГОСТ 8.417). */
  units: Array<{
    quantity: string;
    unit: string;
    symbolRu?: string;
    symbolIntl?: string;
    relation?: string;
  }>;
}

/** Типовой объект ремонта = сцепка [Класс / Подкласс / Код модели]. */
export interface TOR {
  id: string;
  className: string;
  subclassName: string;
  modelCode: string;
  modelId: string;
}
