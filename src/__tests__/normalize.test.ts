import { describe, it, expect } from 'vitest';
import {
  normalizeModelCode,
  normalizeClassName,
  normalizeOperation,
  normalizeCharName,
  normalizeUnit,
} from '../domain/normalize';

// ── normalizeModelCode ──────────────────────────────────────

describe('normalizeModelCode', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeModelCode('').code).toBe('');
    expect(normalizeModelCode(null as unknown as string).code).toBe('');
  });

  it('p1: converts to upper case', () => {
    const r = normalizeModelCode('abc123');
    // Pure Latin — stays Latin (no Cyrillic to trigger p10)
    expect(r.code).toBe('ABC123');
  });

  it('p2: removes unprintable characters and trims', () => {
    const r = normalizeModelCode('  АВС  ');
    expect(r.code).toBe('АВС');
  });

  it('p3: removes separators between letters and digits', () => {
    const r = normalizeModelCode('КВ-16');
    expect(r.code).toBe('КВ16');
  });

  it('p4: replaces separators between letters with a single hyphen', () => {
    const r = normalizeModelCode('АВ  СД');
    expect(r.code).toBe('АВ-СД');
  });

  it('p5: preserves dot between digits, converts others to hyphen', () => {
    expect(normalizeModelCode('100.200').code).toBe('100.200');
    expect(normalizeModelCode('100 200').code).toBe('100-200');
  });

  it('p6: converts comma between digits to dot', () => {
    const r = normalizeModelCode('3,14');
    expect(r.code).toBe('3.14');
    expect(r.applied).toContain('p6: запятая между цифрами → точка');
  });

  it('p7: moves №<digits> to the end in parentheses', () => {
    const r = normalizeModelCode('АБВ №123 тест');
    expect(r.code).toContain('(№123)');
    expect(r.code.endsWith('(№123)')).toBe(true);
  });

  it('p8: replaces X as dimension separator (digit×digit)', () => {
    const r = normalizeModelCode('100х200');
    expect(r.code).toBe('100-200');
  });

  it('p10: converts Latin homoglyphs to Cyrillic when Cyrillic present', () => {
    // The "A","B","C" are Latin, "Б" is Cyrillic → converts all to Cyrillic
    const r = normalizeModelCode('ABCБ');
    expect(r.code).toBe('АВСБ');
    expect(r.applied.some((a) => a.startsWith('p10'))).toBe(true);
  });

  it('p10: keeps Latin when no Cyrillic present', () => {
    const r = normalizeModelCode('ABC123');
    expect(r.code).toBe('ABC123');
  });

  it('p13: removes disallowed special characters', () => {
    const r = normalizeModelCode('АБ@#$%ВГ');
    expect(r.code).toBe('АБ-ВГ');
  });

  it('preserves parentheses', () => {
    const r = normalizeModelCode('КВ(16)');
    expect(r.code).toContain('(');
    expect(r.code).toContain(')');
  });

  it('handles realistic industrial codes', () => {
    expect(normalizeModelCode('НД-2,5-16/100').code).toBe('НД2.5-16-100');
    expect(normalizeModelCode('ЦНС 300/600').code).toBe('ЦНС300-600');
  });

  it('respects disabled rules', () => {
    // When p1 (uppercase) is disabled, lowercase letters don't match
    // the uppercase-only LETTER_CHAR pattern and get stripped by p3-5.
    const disabled = new Set(['p1']);
    const r = normalizeModelCode('АБ123', disabled);
    // Cyrillic uppercase survives even without p1
    expect(r.code).toBe('АБ123');
  });
});

// ── normalizeClassName ──────────────────────────────────────

describe('normalizeClassName', () => {
  it('returns empty for empty input', () => {
    expect(normalizeClassName('')).toBe('');
  });

  it('capitalizes first letter, lowercases rest', () => {
    expect(normalizeClassName('НАСОСЫ')).toBe('Насосы');
    expect(normalizeClassName('компрессоры')).toBe('Компрессоры');
  });

  it('replaces ё with е', () => {
    const result = normalizeClassName('Ёлки');
    expect(result).not.toContain('Ё');
  });
});

// ── normalizeOperation ──────────────────────────────────────

describe('normalizeOperation', () => {
  it('returns empty for empty input', () => {
    expect(normalizeOperation('')).toBe('');
  });

  it('normalizes whitespace and casing', () => {
    const r = normalizeOperation('  ЗАМЕНА   МАСЛА  ');
    expect(r).toBe('Замена масла');
  });

  it('removes quotes and disallowed characters', () => {
    expect(normalizeOperation('«Проверка» замена')).toBe('Проверка замена');
  });
});

// ── normalizeCharName ───────────────────────────────────────

describe('normalizeCharName', () => {
  it('normalizes characteristic names', () => {
    expect(normalizeCharName('МОЩНОСТЬ НОМИНАЛЬНАЯ')).toBe('Мощность номинальная');
    expect(normalizeCharName('масса, кг')).toBe('Масса, кг');
  });
});

// ── normalizeUnit ───────────────────────────────────────────

describe('normalizeUnit', () => {
  it('returns undefined for empty/text/dash', () => {
    expect(normalizeUnit(undefined)).toBeUndefined();
    expect(normalizeUnit('')).toBeUndefined();
    expect(normalizeUnit('текст')).toBeUndefined();
    expect(normalizeUnit('—')).toBeUndefined();
  });

  it('maps common synonyms to canonical form', () => {
    expect(normalizeUnit('kw')).toBe('кВт');
    expect(normalizeUnit('КВТ')).toBe('кВт');
    expect(normalizeUnit('rpm')).toBe('об/мин');
    expect(normalizeUnit('kg')).toBe('кг');
    expect(normalizeUnit('mm')).toBe('мм');
    expect(normalizeUnit('бар')).toBe('бар');
  });
});
