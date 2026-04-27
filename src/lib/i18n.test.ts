import { describe, expect, it } from 'vitest';
import { isLocale, parseAcceptLanguage, translateError } from './i18n.js';

describe('i18n', () => {
  it('parseAcceptLanguage picks first recognised tag', () => {
    expect(parseAcceptLanguage('ky-KG,ky;q=0.9,ru;q=0.8')).toBe('kg'); // ky → kg
    expect(parseAcceptLanguage('kg,ru;q=0.8')).toBe('kg');
    expect(parseAcceptLanguage('ru-RU,ru;q=0.9,en;q=0.5')).toBe('ru');
    expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('ru'); // fallback
    expect(parseAcceptLanguage(undefined)).toBe('ru');
  });

  it('isLocale narrows correctly', () => {
    expect(isLocale('ru')).toBe(true);
    expect(isLocale('kg')).toBe(true);
    expect(isLocale('ky')).toBe(false); // ky is no longer a valid locale
    expect(isLocale('en')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('translateError returns localized message', () => {
    expect(translateError('SEATS_NOT_AVAILABLE', 'ru')).toContain('Свободных');
    expect(translateError('SEATS_NOT_AVAILABLE', 'kg')).toContain('Бош');
  });
});
