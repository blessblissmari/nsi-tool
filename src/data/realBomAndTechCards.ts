/**
 * Реальные BOM и примеры строк техкарты из файлов Простоев.Нет
 * («Формирование справочника BOM ПРГ-160.xlsx», «…BOM T6.2.6.xlsx»,
 * «Шаблон ТехКарты.xlsx»). Используются двумя путями:
 *
 *  1. Для классификатора (класс + подкласс) из таблицы `BOM_BY_CLASS`:
 *     если у модели совпадает класс/подкласс — подставляем реальный
 *     BOM без обращения к ИИ (точность 100%).
 *  2. Как few-shot-примеры для ИИ-промпта (`bomFewShot`,
 *     `techCardFewShot`) — чтобы генерация шла в точно таком же
 *     стиле, что реальные данные (формулировки, единицы, колонки).
 */
import raw from './realBomAndTechCards.json';

export interface RealBomItem {
  className: string;
  subclassName: string;
  model: string;
  position: number | null;
  designation: string | null;
  name: string;
  qty: number | null;
  unit: string | null;
  source: string | null;
}

export interface RealTechCardRow {
  Класс: string;
  Подкласс: string;
  'Нормализованный код модели': string;
  Элемент: string;
  Подэлемент: string;
  'Наименование операции': string;
  'Краткое содержание работ': string;
  'Вид ТОиР': string;
  Периодичность: number | string;
  'Норма времени, часов': number | string;
  'Количество исполнителей': number | string;
  'Профессия/Квалификация': string;
  'Трудоёмкость, человеко/часов': number | string;
  'Наименование ТМЦ': string | null;
  'Количество ТМЦ': number | null;
  'Единицы измерения ТМЦ': string | null;
  'Наименование инструменты': string | null;
  'Средства индивидуальной защиты': string | null;
  'Требования по безопасности': string | null;
}

interface Bundle {
  bomByClass: Record<string, { model: string; items: RealBomItem[] }>;
  techCardExamples: RealTechCardRow[];
}

const bundle = raw as unknown as Bundle;

/**
 * Ключ `${className}/${subclassName}` → реальный BOM.
 * Сейчас покрыты 2 класса/подкласса (Диспергаторы/Аппараты
 * проточно-роторные, Конвейеры/Ленточные).
 */
export const BOM_BY_CLASS: Record<string, { model: string; items: RealBomItem[] }> =
  bundle.bomByClass;

export const TECH_CARD_TEMPLATE_ROWS: RealTechCardRow[] = bundle.techCardExamples;

/**
 * Возвращает первые N пунктов реального BOM для класса/подкласса в
 * компактном виде — удобно подставлять в промпт LLM как few-shot
 * пример стиля и детализации.
 */
export function bomFewShot(
  className: string | undefined,
  subclassName: string | undefined,
  limit = 10,
): string {
  if (!className || !subclassName) return '';
  const key = `${className}/${subclassName}`;
  const entry = BOM_BY_CLASS[key];
  if (!entry) return '';
  const lines = entry.items.slice(0, limit).map(
    (x) =>
      `${x.position ?? ''} · ${x.designation ?? ''} · ${x.name} · ${x.qty ?? ''} ${x.unit ?? ''}`,
  );
  return `Пример реального BOM для подкласса «${subclassName}» (модель ${entry.model}, из паспорта):\n${lines.join('\n')}`;
}

/**
 * Первые N строк из «Шаблон ТехКарты.xlsx» — пример оформления
 * техкарты (формулировки операций, краткое содержание работ,
 * инструменты, СИЗ, требования по безопасности).
 */
export function techCardFewShot(limit = 3): string {
  const lines = TECH_CARD_TEMPLATE_ROWS.slice(0, limit).map((r, i) => {
    const specialty = r['Профессия/Квалификация'];
    const tmc = r['Наименование ТМЦ']
      ? `${r['Наименование ТМЦ']} (${r['Количество ТМЦ'] ?? '-'} ${r['Единицы измерения ТМЦ'] ?? ''})`
      : '—';
    return `Пример ${i + 1}: Элемент «${r.Элемент}» → Подэлемент «${r.Подэлемент}» → Операция «${r['Наименование операции']}» (${r['Вид ТОиР']}, период ${r.Периодичность} ч). Содержание: «${r['Краткое содержание работ']}». Норма времени ${r['Норма времени, часов']} ч × ${r['Количество исполнителей']} чел = ${r['Трудоёмкость, человеко/часов']} чел/ч. Профессия: ${specialty}. ТМЦ: ${tmc}. Инструменты: ${r['Наименование инструменты'] ?? '—'}. СИЗ: ${r['Средства индивидуальной защиты'] ?? '—'}. Безопасность: ${r['Требования по безопасности'] ?? '—'}.`;
  });
  return lines.join('\n\n');
}
