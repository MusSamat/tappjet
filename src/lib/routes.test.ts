import { describe, expect, it } from 'vitest';
import { estimateDurationMin, lookupRoute } from './routes.js';

describe('route reference', () => {
  it('is symmetric (A→B == B→A)', () => {
    const ab = lookupRoute('Бишкек', 'Ош');
    const ba = lookupRoute('Ош', 'Бишкек');
    expect(ab).not.toBeNull();
    expect(ab).toEqual(ba);
  });

  it('knows launch routes', () => {
    expect(lookupRoute('Бишкек', 'Ош')?.durationMin).toBe(600);
    expect(lookupRoute('Бишкек', 'Каракол')?.durationMin).toBe(360);
    expect(lookupRoute('Бишкек', 'Нарын')?.durationMin).toBe(300);
  });

  it('falls back to default on unknown pair', () => {
    expect(estimateDurationMin('Бишкек', 'Марс')).toBe(240);
    expect(estimateDurationMin('Бишкек', 'Марс', 999)).toBe(999);
  });
});
