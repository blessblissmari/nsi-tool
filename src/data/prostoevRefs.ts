// Справочники «Простоев.Нет» по умолчанию (п.6.4–6.5 ТЗ).
// Сгенерировано из бандлированных xlsx «Готовые данные 15.04.2026».
//
// - ВВ и периодичности — из «Справочник ВВ и периодичностей.xlsx»
// - Операции ТОиР — из «Справочник операций.xlsx» (лист «1 Справочник названия операций»)
// - Специальности/квалификации — из «Справочник специальности и квалификации.xlsx»
// - ВВ/периодичности на ТОР из истории эксплуатации — из «Виды воздействия на ТОР ист.xlsx»
// - Характеристики и единицы (ГОСТ 8.417) — из «Характеристики и ед. измерения.xlsx»
//
// JSON поставляется рядом (src/data/prostoevRefs.json) — Vite инлайнит его в
// бандл.
import rawRefs from './prostoevRefs.json';
import type { ReferenceData } from '../domain/types';

interface RawRefs {
  vvDict: Record<string, number[]>;
  actionsByModel: Array<{
    model: string;
    actions: Array<{ name: string; periodHours: number | null }>;
  }>;
  operations: string[];
  specialties: Array<{ name: string; qualifications: string[] }>;
  characteristics: Array<{ name: string; units: string[] }>;
  charsByModel: Array<{
    model: string;
    chars: Array<{
      key: string;
      value: number | string;
      unit: string | null;
      order: number;
    }>;
  }>;
}

const raw = rawRefs as unknown as RawRefs;

const STANDARD_OPS = new Set([
  'Демонтаж', 'Монтаж', 'Осмотр', 'Смазка', 'Замена', 'Регулировка',
  'Диагностика', 'Чистка', 'Проверка', 'Промывка', 'Ревизия', 'Испытание',
  'Контроль', 'Затяжка', 'Центровка', 'Балансировка', 'Покраска',
  'Продувка', 'Прокачка', 'Опрессовка',
]);

export const PROSTOEV_ACTIONS_BY_MODEL: RawRefs['actionsByModel'] =
  raw.actionsByModel;

export const PROSTOEV_CHARS_BY_MODEL: RawRefs['charsByModel'] =
  raw.charsByModel;

export const PROSTOEV_REFERENCES: ReferenceData = {
  // Уплощаем dict{name:[periods]} → [{name, periodHours}] по каждой
  // периодичности, сохраняя вариативность (ТО-1 бывает 24, 72, 168 часов
  // и т.п.).
  actions: Object.entries(raw.vvDict).flatMap(([name, periods]) =>
    periods.length > 0
      ? periods.map((p) => ({ name, periodHours: p }))
      : [{ name, periodHours: 0 }],
  ),
  operations: raw.operations.map((n) => ({ name: n, standard: STANDARD_OPS.has(n) || n.length <= 15 })),
  specialties: raw.specialties.map((s) => ({
    name: s.name,
    qualifications: s.qualifications,
  })),
  units: raw.characteristics.flatMap((c) =>
    c.units.map((u) => ({ quantity: c.name, unit: u, symbolRu: u })),
  ),
};

/** Количество записей в каждом справочнике — для UI-диагностики. */
export const PROSTOEV_REFS_COUNTS = {
  actions: PROSTOEV_REFERENCES.actions.length,
  operations: PROSTOEV_REFERENCES.operations.length,
  specialties: PROSTOEV_REFERENCES.specialties.length,
  units: PROSTOEV_REFERENCES.units.length,
  vvTypes: Object.keys(raw.vvDict).length,
  characteristics: raw.characteristics.length,
};
