import { describe, expect, it } from 'vitest';
import { filterPhoneNumbers } from './phoneFilter.js';

describe('filterPhoneNumbers', () => {
  it('redacts +996 numbers with various separators', () => {
    expect(filterPhoneNumbers('call me +996 700 123 456').filtered).toContain('[номер скрыт]');
    expect(filterPhoneNumbers('+996700123456').filtered).toContain('[номер скрыт]');
    expect(filterPhoneNumbers('+996-555-12-34-56').filtered).toContain('[номер скрыт]');
  });

  it('redacts local 0-prefixed 10-digit numbers', () => {
    expect(filterPhoneNumbers('0700 123 456').filtered).toContain('[номер скрыт]');
  });

  it('redacts bare runs of 9+ digits', () => {
    expect(filterPhoneNumbers('пиши на 700123456').filtered).toContain('[номер скрыт]');
  });

  it('leaves normal text alone', () => {
    const { filtered, redacted } = filterPhoneNumbers('Встречаемся в 8:30 у вокзала');
    expect(filtered).toBe('Встречаемся в 8:30 у вокзала');
    expect(redacted).toBe(false);
  });

  it('leaves short numbers alone (year, cost)', () => {
    const { filtered, redacted } = filterPhoneNumbers('цена 500 сом, встреча в 2026');
    expect(filtered).toBe('цена 500 сом, встреча в 2026');
    expect(redacted).toBe(false);
  });

  it('reports redacted=true when anything was replaced', () => {
    expect(filterPhoneNumbers('+996700111222').redacted).toBe(true);
  });
});
