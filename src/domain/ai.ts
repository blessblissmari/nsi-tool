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
    Array<Pick<ActionItem, 'name' | 'kind' | 'periodHours'> & { reason?: string }>
  >;

  /**
   * Обогащение характеристик из «интернета» (п.6.3 ТЗ — функция обогащения
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
      }
    >
  >;

  /**
   * Обогащение спецификаций (BOM/APL) из «интернета» (п.6.6 ТЗ).
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
   * Заполнение техкарты по шаблону Простоев.Нет (п.6.5 ТЗ). На основе
   * модели, класса, подкласса и списка ВВ генерирует типовую техкарту:
   * компонент → операция → ВВ → профессия → норма времени → ТМЦ.
   *
   * Колонки соответствуют «Шаблон ТехКарты.xlsx»: Элемент/Подэлемент,
   * Наименование операции, Вид ТОиР, Норма времени, Количество
   * исполнителей, Профессия/Квалификация, Трудоёмкость, ТМЦ/кол./ед.
   */
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
};

let current: AiProvider = noopAiProvider;
export function aiProvider(): AiProvider {
  return current;
}
export function setAiProvider(p: AiProvider): void {
  current = p;
}
