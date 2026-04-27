/**
 * Нормализация наименований моделей оборудования согласно п.8.3 ТЗ.
 *
 *  1) Все буквы — в верхнем регистре.
 *  2) Удаляются непечатные символы; пробелы трактуются как разделители.
 *  3) Между буквами и цифрами удаляются все знаки.
 *  4) Разделители между буквами заменяются на дефис.
 *  5) Точка между цифрами сохраняется. Прочие разделители между цифрами → дефис.
 *  6) Запятые между цифрами заменяются на точки.
 *  7) Если есть знак № и последующие цифры — `(№…)` в конце.
 *  8) Латинская «x» (X/х/Х) как разделитель размеров заменяется на дефис.
 *  9) Кириллические буквы кроме «ё»/«Ё» разрешены.
 * 10) Латиница-омоглифы (А, В, С, Е, Н, К, М, О, Р, Т, Х) приводятся к кириллице,
 *     если в коде уже есть кириллические буквы.
 * 11) Арабские цифры разрешены.
 * 12) Римские цифры (как латинские буквы и кодпойнты U+2160…U+216F) разрешены.
 * 13) Разрешённые спецсимволы: «.», «-», «№», «(», «)».
 */

const LATIN_LOOKALIKES: Record<string, string> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
};

const CYR = /[А-Я]/;
const LAT = /[A-Z]/;
const DIGIT = /[0-9]/;
// Допустимые «буквы» — кириллица и латиница.
const LETTER_CHAR = /[A-ZА-Я]/;
// Греческие заглавные (как Roman-numeral lookalikes — например, «Ι» в WTMNTF97-Ι)
// и Unicode Roman-numeral codepoints трактуются как цифры (рим.цифры по п.12).
const ROMAN_NUMERAL = /[Α-Ω\u2160-\u216F]/;

function isLetter(ch: string): boolean {
  return LETTER_CHAR.test(ch);
}
function isDigit(ch: string): boolean {
  return DIGIT.test(ch) || ROMAN_NUMERAL.test(ch);
}
function classOf(ch: string): 'L' | 'D' | 'O' {
  if (!ch) return 'O';
  if (isLetter(ch)) return 'L';
  if (isDigit(ch)) return 'D';
  return 'O';
}

/**
 * Главная функция нормализации.
 * Возвращает нормализованный код и список применённых правил.
 */
export function normalizeModelCode(
  input: string,
  /** id отключённых правил из `rules.modelRules` (по умолчанию все включены). */
  disabled?: ReadonlySet<string>,
): {
  code: string;
  applied: string[];
  warnings: string[];
} {
  const off = (id: string) => disabled?.has(id) ?? false;
  const applied: string[] = [];
  const warnings: string[] = [];
  let s = String(input ?? '');
  if (!s) return { code: '', applied, warnings };

  // (2) непечатные символы → удалить; trim. Пробелы внутри — оставляем
  //     как разделители (они пройдут логику п.3-5).
  if (!off('p2')) {
    const before2 = s;
    // eslint-disable-next-line no-control-regex
    s = s.replace(/[\u0000-\u001F\u007F]/g, '');
    s = s.trim();
    if (s !== before2) applied.push('p2: убраны непечатные символы / trim');
  }

  // (1) Верхний регистр
  if (!off('p1')) {
    const before1 = s;
    s = s.toUpperCase();
    if (s !== before1) applied.push('p1: верхний регистр');
  }

  // (9) Запрещены ё/Ё → заменяем на е/Е
  if (!off('p9') && /[Её]/.test(s)) {
    s = s.replace(/Ё/g, 'Е').replace(/ё/g, 'е');
    applied.push('p9: ё→е');
  }

  // (10) Латиница-омоглифы → кириллица, только если в коде уже есть кириллица.
  if (!off('p10')) {
    const hasCyr = CYR.test(s);
    if (hasCyr) {
      let any = false;
      s = s.replace(/[ABCEHKMOPTX]/g, (ch) => {
        any = true;
        return LATIN_LOOKALIKES[ch] ?? ch;
      });
      if (any) applied.push('p10: латиница-омоглифы → кириллица');
    }
  }

  // (7) Извлекаем «№<цифры>» → перенесём в конец как «(№<цифры>)»
  let suffix = '';
  if (!off('p7')) {
    const noMatches: string[] = [];
    s = s.replace(/№\s*(\d+)/g, (_m, g1) => {
      noMatches.push(`(№${g1})`);
      return ' ';
    });
    if (noMatches.length) {
      suffix = noMatches.join('');
      applied.push('p7: №<цифры> вынесен в конец');
    }
  }

  // (8) Латинская «X» как разделитель → «-».
  // (после toUpperCase и (10) она могла стать кириллической «Х»).
  if (!off('p8')) {
    const before8 = s;
    s = s.replace(/(\d)[XХ](\d)/g, '$1-$2');
    s = s.replace(/(\d)[XХ]([A-ZА-Я])/g, '$1-$2');
    s = s.replace(/([A-ZА-Я])[XХ](\d)/g, '$1-$2');
    if (s !== before8) applied.push('p8: «x» как разделитель → «-»');
  }

  // (6) Запятые между цифрами → точка
  if (!off('p6')) {
    const before6 = s;
    s = s.replace(/(\d),(\d)/g, '$1.$2');
    if (s !== before6) applied.push('p6: запятая между цифрами → точка');
  }

  // (3)/(4)/(5): проходим по строке, обрабатывая разделители между классами символов.
  let out = '';
  let i = 0;
  let changedSep = false;
  while (i < s.length) {
    const ch = s[i];
    if (isLetter(ch) || isDigit(ch)) {
      out += ch;
      i++;
      continue;
    }
    // собираем подряд идущие «знаки/пробелы»
    let j = i;
    while (j < s.length && !isLetter(s[j]) && !isDigit(s[j])) j++;
    const sep = s.slice(i, j);
    const prev = out.length ? out[out.length - 1] : '';
    const next = j < s.length ? s[j] : '';
    const cp = classOf(prev);
    const cn = classOf(next);

    // Скобки — оставляем, остальное внутри них чистим
    const hasParen = /[()]/.test(sep);
    if (hasParen) {
      out += sep.replace(/[^()\-.]/g, '');
      i = j;
      changedSep = true;
      continue;
    }

    if (cp === 'O' || cn === 'O') {
      // граница строки — отбрасываем посторонние символы
      i = j;
      changedSep = true;
      continue;
    }
    if (cp === 'L' && cn === 'D') {
      // (3) удалить
      i = j;
      changedSep = changedSep || sep.length > 0;
      continue;
    }
    if (cp === 'D' && cn === 'L') {
      // (3) удалить
      i = j;
      changedSep = changedSep || sep.length > 0;
      continue;
    }
    if (cp === 'L' && cn === 'L') {
      // (4) → дефис (одиночный, даже если разделителей было несколько)
      out += '-';
      i = j;
      changedSep = changedSep || sep !== '-';
      continue;
    }
    // cp === 'D' && cn === 'D'
    // (5) точка сохраняется; иначе любой разделитель между цифрами → дефис.
    if (sep.includes('.')) {
      out += '.';
      changedSep = changedSep || sep !== '.';
    } else {
      out += '-';
      changedSep = changedSep || sep !== '-';
    }
    i = j;
  }
  if (changedSep) applied.push('p3-5: нормализованы разделители');
  s = out;

  // Чистим возможные двойные дефисы/точки
  s = s.replace(/-+/g, '-').replace(/\.+/g, '.');

  // Добавляем суффикс с № в конец
  s += suffix;

  // (13) Финальная фильтрация: оставляем буквы, цифры и допустимые спецсимволы.
  if (!off('p13')) {
    const before13 = s;
    s = s.replace(/[^A-ZА-ЯΑ-Ω\u2160-\u216F0-9.\-№()]/g, '');
    if (s !== before13) applied.push('p13: удалены недопустимые символы');
  }

  // Предупреждения
  if (LAT.test(s) && CYR.test(s)) {
    warnings.push('Смешанная кириллица и латиница в коде');
  }

  return { code: s, applied, warnings };
}

/** Нормализация наименования класса/подкласса (п.8.2). */
export function normalizeClassName(input: string): string {
  let s = String(input ?? '').trim();
  if (!s) return '';
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001F\u007F]/g, '');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/Ё/g, 'Е').replace(/ё/g, 'е');
  s = s.charAt(0).toLocaleUpperCase('ru-RU') + s.slice(1).toLocaleLowerCase('ru-RU');
  return s;
}
