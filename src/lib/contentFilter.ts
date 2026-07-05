import { filterPhoneNumbers } from './phoneFilter.js';
import { filterSocialLinks } from './socialFilter.js';

/**
 * Redacts contact info (phone numbers + social/messenger links & @handles) from
 * user-authored public text — trip/request descriptions. Keeps the platform the
 * only channel before a booking, same policy as pre-booking chat. Returns the
 * cleaned text (or null passthrough) and whether anything was removed.
 */
export function redactContactInfo(text: string | null | undefined): {
  clean: string | null;
  redacted: boolean;
} {
  if (!text) return { clean: text ?? null, redacted: false };
  let out = text;
  let redacted = false;
  const phone = filterPhoneNumbers(out);
  if (phone.redacted) {
    out = phone.filtered;
    redacted = true;
  }
  const social = filterSocialLinks(out);
  if (social.redacted) {
    out = social.filtered;
    redacted = true;
  }
  return { clean: out, redacted };
}
