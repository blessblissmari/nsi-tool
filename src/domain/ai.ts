/**
 * Точка подключения LLM. Сейчас — заглушка, не вызывает внешнюю сеть.
 *
 * Реализация подключается заменой `setAiProvider({ classify, extractChars, ... })`
 * на старте приложения. UI читает результаты через `aiProvider.classify(...)` и
 * пишет их в `model.classificationProposals` с `source = 'ai'`.
 *
 * Контракты намеренно простые и совместимы со схемой `ClassificationProposal` /
 * `Characteristic` / `ActionItem`, чтобы провайдер на стороне сервера/Edge мог
 * быть тонким wrapper-ом над OpenAI / Anthropic / собственной моделью.
 */
import type {
  ActionItem,
  Characteristic,
  ClassDef,
  ClassificationProposal,
  EquipmentModel,
} from './types';

export interface AiProvider {
  /** Подсказать класс/подкласс по коду модели и тексту документов. */
  classify(input: {
    model: Pick<EquipmentModel, 'rawCode' | 'normalizedCode'>;
    /** Доступные классы — чтобы LLM выбирал из них, а не выдумывал. */
    classes: ClassDef[];
    /** Распознанный текст документов модели (опционально). */
    docText?: string;
  }): Promise<ClassificationProposal[]>;

  /** Извлечь характеристики из текста документа в нужный формат. */
  extractCharacteristics(input: {
    text: string;
    /** Список приоритетных характеристик класса/подкласса. */
    keys: Array<{ key: string; unit?: string }>;
  }): Promise<Array<Pick<Characteristic, 'key' | 'valueRaw' | 'unit'>>>;

  /** Подобрать ВВ (ТО/ремонт) для модели на основе аналогов и интернета. */
  suggestActions(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode'>;
  }): Promise<
    Array<Pick<ActionItem, 'name' | 'kind' | 'periodHours'> & {
      reason?: string;
      /** URL источника регламента производителя, если ИИ его уверенно знает. */
      sourceUrl?: string;
    }>
  >;

  /**
   * Обогащение характеристик из «интернета» (п.6.3 — функция обогащения
   * значений характеристик из открытых источников). Вход — модель + список
   * приоритетных характеристик, выход — типовые/паспортные значения,
   * полученные из общедоступной информации о модели.
   *
   * В отличие от `extractCharacteristics`, не требует текста документа:
   * используется знание провайдера о конкретных моделях оборудования.
   */
  enrichCharacteristicsFromWeb(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
    keys: Array<{ key: string; unit?: string }>;
  }): Promise<
    Array<
      Pick<Characteristic, 'key' | 'valueRaw' | 'unit'> & {
        confidence?: number;
        reason?: string;
        /** URL источника, если ИИ его уверенно знает (https://). */
        sourceUrl?: string;
      }
    >
  >;

  /**
   * Обогащение спецификаций (BOM/APL) из «интернета».
   * Возвращает типовой перечень ТМЦ для модели, привязанный к конкретным ВВ.
   * `mode='bom'` — материалы + запчасти (полный перечень ТМЦ);
   * `mode='apl'` — только запчасти/инструменты, без расходных материалов.
   */
  enrichBomFromWeb(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
    actions: Array<{ id: string; name: string }>;
    mode: 'bom' | 'apl';
  }): Promise<
    Array<{
      actionId?: string;
      actionName?: string;
      tmcName: string;
      tmcKind: 'material' | 'spare';
      tmcUnit?: string;
      tmcQty?: number;
      confidence?: number;
      reason?: string;
    }>
  >;

  /**
   * Заполнение техкарты по шаблону Простоев.Нет. На основе
   * модели, класса, подкласса и списка ВВ генерирует типовую техкарту:
   * компонент → операция → ВВ → профессия → норма времени → ТМЦ.
   *
   * Колонки соответствуют «Шаблон ТехКарты.xlsx»: Элемент/Подэлемент,
   * Наименование операции, Вид ТОиР, Норма времени, Количество
   * исполнителей, Профессия/Квалификация, Трудоёмкость, ТМЦ/кол./ед.
   */
  /**
   * Оценка надёжности по аналогам из открытых источников (созвон 28.04.2026).
   * Если статистики отказов нет — ИИ возвращает типовые MTBF, MTTR, λ
   * для класса/подкласса по данным каталогов и стандартов (ISO/IEC 60300,
   * данные производителей). Для прозрачности отдельно возвращает
   * кол-во моделей-аналогов, на которых основана оценка.
   */
  estimateReliabilityFromWeb?(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
  }): Promise<{
    mtbfHours?: number;
    mttrHours?: number;
    lambdaPerHour?: number;
    availability?: number;
    confidence?: number;
    reason?: string;
    sourceUrl?: string;
    analogCount?: number;
  }>;

  /**
   * Этап 3 ручного workflow (промпт нач-ка): «Состав». Извлекает из текста
   * документа и/или общих знаний типовой состав элементов и подэлементов.
   * Каждый элемент/подэлемент — отдельной строкой (по правилам нач-ка:
   * существительное в им.падеже ед.числе, без крепежа — гайки/шайбы/болты
   * и т.п. в состав не включаем).
   */
  fillElementsAndSubelements(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
    docText?: string;
  }): Promise<
    Array<{
      component: string;
      subcomponent?: string;
      confidence?: number;
    }>
  >;

  /**
   * Этап 4 ручного workflow (промпт нач-ка): «Операции». На вход — список
   * имеющихся элементов/подэлементов (component/subcomponent), на выход —
   * операции по каждому, по правилам нач-ка:
   *  - «Демонтаж» вместо «снятие/удаление»; «Монтаж» вместо «установка»;
   *  - «Замена» = «Демонтаж» + «Монтаж» (две строки);
   *  - всегда обеспечиваем пару Демонтаж↔Монтаж для каждого элемента/
   *    подэлемента;
   *  - дубликаты строк удаляем.
   */
  fillOperationsForElements(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
    components: Array<{ component: string; subcomponent?: string }>;
    operationsRef?: string[];
    docText?: string;
  }): Promise<
    Array<{
      component: string;
      subcomponent?: string;
      operation: string;
      workDescription?: string;
      confidence?: number;
    }>
  >;

  /**
   * Каскад «🔎 Сверить элементы» (созвон 28.04.2026): проверка состава
   * (Элемент / Подэлемент) против эталонных данных. Этапы:
   *   1. поиск по точному коду модели (если знает производителя);
   *   2. поиск по похожей модели (тот же подкласс / другой код);
   *   3. поиск по классу / подклассу (типовой состав);
   *   4. финальная сверка с тем, что уже введено в техкарте.
   *
   * На вход идёт текущий состав; на выход — рекомендации:
   *  - что добавить (новые элементы);
   *  - что переименовать (нормализация);
   *  - что убрать (явный мусор / крепёж).
   */
  verifyElementsAndSubelements?(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
    /** Текущий состав техкарты (чтобы ИИ сверил, а не выдумал заново). */
    current: Array<{ component: string; subcomponent?: string }>;
    /** Аналоги — название модели, чтобы ИИ опирался на конкретные изделия. */
    analogs?: Array<{ code: string }>;
  }): Promise<{
    add: Array<{
      component: string;
      subcomponent?: string;
      stage: 'model' | 'similar' | 'class' | 'final';
      reason?: string;
      sourceUrl?: string;
    }>;
    rename: Array<{
      from: string;
      to: string;
      stage: 'model' | 'similar' | 'class' | 'final';
      reason?: string;
    }>;
    remove: Array<{
      component: string;
      subcomponent?: string;
      reason?: string;
    }>;
    confidence?: number;
    sourceUrl?: string;
  }>;

  /**
   * Поиск аналогов модели через интернет (созвон 28.04.2026: «поиск аналогов
   * по интернету в окне аналоги»). Возвращает 3-8 моделей-аналогов с
   * приоритетными характеристиками для сравнения и ссылкой на источник
   * (каталог / маркетплейс / справочник производителя).
   */
  searchAnalogsFromWeb?(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
    keys: Array<{ key: string; unit?: string }>;
  }): Promise<
    Array<{
      code: string;
      manufacturer?: string;
      characteristics: Array<{ key: string; valueRaw: string; unit?: string }>;
      reason?: string;
      sourceUrl?: string;
    }>
  >;

  fillTechCardByTemplate(input: {
    model: Pick<EquipmentModel, 'className' | 'subclassName' | 'normalizedCode' | 'rawCode'>;
    actions: Array<{ id: string; name: string; periodHours?: number }>;
    /** Справочник операций — чтобы AI выбирал из них, а не выдумывал. */
    operations?: string[];
    /** Справочник специальностей с квалификациями. */
    specialties?: Array<{ name: string; qualifications: string[] }>;
  }): Promise<
    Array<{
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
    }>
  >;
}

/** Локальная заглушка — ничего не возвращает. Не делает сетевых вызовов. */
export const noopAiProvider: AiProvider = {
  async classify() {
    return [];
  },
  async extractCharacteristics() {
    return [];
  },
  async suggestActions() {
    return [];
  },
  async enrichCharacteristicsFromWeb() {
    return [];
  },
  async enrichBomFromWeb() {
    return [];
  },
  async fillTechCardByTemplate() {
    return [];
  },
  async fillElementsAndSubelements() {
    return [];
  },
  async fillOperationsForElements() {
    return [];
  },
};

let current: AiProvider = noopAiProvider;
export function aiProvider(): AiProvider {
  return current;
}
export function setAiProvider(p: AiProvider): void {
  current = p;
}
