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
};

let current: AiProvider = noopAiProvider;
export function aiProvider(): AiProvider {
  return current;
}
export function setAiProvider(p: AiProvider): void {
  current = p;
}
