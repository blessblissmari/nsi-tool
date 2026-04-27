/**
 * Базовая нормализация единиц измерения для демо.
 * Конвертирует сырое значение «12,5 kW» / «1500 rpm» / «380V» в SI/каноничную форму.
 */

interface UnitDef {
  /** Канонический ключ. */
  canonical: string;
  /** Все принимаемые написания (нижний регистр, без пробелов). */
  aliases: string[];
  /** Множитель к канонической единице (если необходимо). */
  factor?: number;
  /** Группа величины (для совместимости). */
  group?: string;
}

const UNITS: UnitDef[] = [
  // Мощность
  { canonical: 'кВт', aliases: ['квт', 'kw', 'kvt'], group: 'power', factor: 1 },
  {
    canonical: 'кВт',
    aliases: ['вт', 'w'],
    group: 'power',
    factor: 0.001,
  },
  // Напряжение
  { canonical: 'В', aliases: ['в', 'v'], group: 'voltage', factor: 1 },
  { canonical: 'В', aliases: ['кв', 'kv'], group: 'voltage', factor: 1000 },
  // Ток
  { canonical: 'А', aliases: ['а', 'a'], group: 'current', factor: 1 },
  // Частота
  { canonical: 'Гц', aliases: ['гц', 'hz'], group: 'freq', factor: 1 },
  // Скорость вращения
  {
    canonical: 'об/мин',
    aliases: ['об/мин', 'обмин', 'rpm', 'r/min', 'мин-1'],
    group: 'rpm',
    factor: 1,
  },
  // Размеры
  { canonical: 'мм', aliases: ['мм', 'mm'], group: 'len', factor: 1 },
  { canonical: 'мм', aliases: ['см', 'cm'], group: 'len', factor: 10 },
  { canonical: 'мм', aliases: ['м', 'm'], group: 'len', factor: 1000 },
  // Масса
  { canonical: 'кг', aliases: ['кг', 'kg'], group: 'mass', factor: 1 },
  { canonical: 'кг', aliases: ['г', 'g'], group: 'mass', factor: 0.001 },
  { canonical: 'кг', aliases: ['т', 't'], group: 'mass', factor: 1000 },
  // Температура (без конвертации, только канон)
  { canonical: '°C', aliases: ['°c', 'c', 'град', 'градc'], group: 'temp', factor: 1 },
  { canonical: 'K', aliases: ['k'], group: 'temp_k', factor: 1 },
  // Давление
  { canonical: 'Па', aliases: ['па', 'pa'], group: 'pressure', factor: 1 },
  { canonical: 'кПа', aliases: ['кпа', 'kpa'], group: 'pressure_k', factor: 1 },
  { canonical: 'МПа', aliases: ['мпа', 'mpa'], group: 'pressure_m', factor: 1 },
  { canonical: 'бар', aliases: ['бар', 'bar'], group: 'pressure_bar', factor: 1 },
  // Расход / производительность
  {
    canonical: 'м³/ч',
    aliases: ['м3/ч', 'м3ч', 'm3/h', 'm3h'],
    group: 'flow',
    factor: 1,
  },
  {
    canonical: 'л/мин',
    aliases: ['л/мин', 'l/min', 'lpm'],
    group: 'flow_l',
    factor: 1,
  },
  // Световой поток / КПД
  { canonical: 'лм', aliases: ['лм', 'lm'], group: 'lumen', factor: 1 },
  { canonical: '%', aliases: ['%'], group: 'percent', factor: 1 },
  // Степень защиты
  { canonical: 'IP', aliases: ['ip'], group: 'ip', factor: 1 },
];

/** Нормализованный результат разбора значения. */
export interface ParsedValue {
  raw: string;
  num?: number;
  unit?: string;
}

/**
 * Парсит «12,5 кВт», «380V», «1500 rpm», «IP 54», «м³/ч 600» и т.п.
 * Возвращает нормализованное число и канон. единицу (если опознана).
 */
export function parseValue(raw: string): ParsedValue {
  const r = raw.trim();
  if (!r) return { raw };
  // IP54 / IP 54
  const ipM = /\bIP\s*(\d{2})\b/i.exec(r);
  if (ipM) return { raw, num: Number(ipM[1]), unit: 'IP' };

  // число + единица. Допускаем точки/запятые/знак минус, опциональный exp.
  const m = /(-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?)\s*([^\s,;]*)/.exec(r);
  if (!m) return { raw };
  const numStr = m[1].replace(',', '.');
  const num = Number(numStr);
  if (Number.isNaN(num)) return { raw };
  const unitRaw = (m[2] || '').toLowerCase().replace(/[^a-zа-я0-9°/³%-]/giu, '');
  if (!unitRaw) return { raw, num };
  const u = UNITS.find((x) => x.aliases.includes(unitRaw));
  if (!u) return { raw, num, unit: m[2] || undefined };
  const factor = u.factor ?? 1;
  return { raw, num: num * factor, unit: u.canonical };
}

/** Приводит число к компактному виду без лишних нулей. */
export function fmtNum(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return Number(n.toFixed(4)).toString();
}
