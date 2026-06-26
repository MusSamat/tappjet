// TZ §13.3 pre-booking phase: also filter social media URLs and usernames
// so participants cannot bypass the platform before booking is accepted.

const SOCIAL_PATTERNS: RegExp[] = [
  // Full URLs (http/https)
  /https?:\/\/(?:www\.)?\S+/gi,
  // t.me/username or @username patterns for Telegram
  /(?:^|\s)t\.me\/\S+/gi,
  /(?:^|\s)@[\w.]{3,}/g,
  // WhatsApp, Instagram, VK usernames with obvious prefixes
  /(?:telegram|whatsapp|instagram|insta|vk|вк|телеграм|ватсап)(?:\s*[:\-@#]\s*)[\w.@]+/gi,
];

const REDACTED = '[скрыто]';

export function filterSocialLinks(text: string): { filtered: string; redacted: boolean } {
  let filtered = text;
  let redacted = false;
  for (const re of SOCIAL_PATTERNS) {
    const before = filtered;
    filtered = filtered.replace(re, (match) => {
      const lead = /^\s/.test(match) ? match[0] : '';
      return `${lead}${REDACTED}`;
    });
    if (filtered !== before) redacted = true;
  }
  return { filtered, redacted };
}
