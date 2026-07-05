import { describe, it, expect } from 'vitest';
import { redactContactInfo } from './contentFilter.js';

describe('redactContactInfo', () => {
  it('removes phone numbers from descriptions', () => {
    const r = redactContactInfo('Пишите на +996700123456 договоримся');
    expect(r.redacted).toBe(true);
    expect(r.clean).not.toContain('700123456');
  });
  it('removes telegram/whatsapp handles and links', () => {
    const r = redactContactInfo('мой тг @ivan или wa.me/996700111222');
    expect(r.redacted).toBe(true);
    expect(r.clean).not.toContain('@ivan');
  });
  it('leaves clean text untouched', () => {
    const r = redactContactInfo('Еду с багажом, встретимся у вокзала');
    expect(r.redacted).toBe(false);
    expect(r.clean).toBe('Еду с багажом, встретимся у вокзала');
  });
  it('passes through null/empty', () => {
    expect(redactContactInfo(null)).toEqual({ clean: null, redacted: false });
    expect(redactContactInfo(undefined).clean).toBeNull();
  });
});
