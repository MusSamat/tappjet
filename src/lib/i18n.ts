import ru from '@/locales/ru.json' with { type: 'json' };
import kg from '@/locales/kg.json' with { type: 'json' };
import type { ErrorCodeValue } from '@/lib/errors.js';

export type Locale = 'ru' | 'kg';

const DICTIONARIES: Record<Locale, typeof ru> = { ru, kg };

export function isLocale(v: string | undefined): v is Locale {
  return v === 'ru' || v === 'kg';
}

/**
 * Pick a locale from Accept-Language header.
 * Accepts both 'kg' and legacy 'ky' (BCP-47 tag for Kyrgyz).
 * Strategy: first matching token wins; else 'ru' (default).
 */
export function parseAcceptLanguage(header: string | undefined): Locale {
  if (!header) return 'ru';
  const tokens = header.split(',').map((t) => t.trim().toLowerCase());
  for (const token of tokens) {
    const primary = token.split(/[-;]/)[0];
    if (primary === 'ru') return 'ru';
    if (primary === 'kg' || primary === 'ky') return 'kg';
  }
  return 'ru';
}

export function translateError(code: ErrorCodeValue, locale: Locale): string {
  return DICTIONARIES[locale]?.errors[code] ?? DICTIONARIES.ru.errors[code] ?? code;
}
