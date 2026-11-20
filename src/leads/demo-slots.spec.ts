import { generateSlots, parseSlotConfig, zonedToUtc } from './demo-slots';

describe('demo slots', () => {
  it('converts a Kolkata wall time to UTC', () => {
    expect(zonedToUtc(2026, 11, 23, 10 * 60, 'Asia/Kolkata').toISOString()).toBe('2026-11-23T04:30:00.000Z');
  });

  it('handles a DST zone on both sides of the change', () => {
    expect(zonedToUtc(2026, 3, 27, 9 * 60, 'Europe/London').toISOString()).toBe('2026-03-27T09:00:00.000Z');
    expect(zonedToUtc(2026, 3, 30, 9 * 60, 'Europe/London').toISOString()).toBe('2026-03-30T08:00:00.000Z');
  });

  it('offers weekday slots only, after the notice period', () => {
    const cfg = parseSlotConfig((k) => ({ DEMO_TIMEZONE: 'Asia/Kolkata', DEMO_HOURS: '10:00-12:00', DEMO_SLOT_MINUTES: '30', DEMO_WINDOW_DAYS: '7', DEMO_MIN_NOTICE_HOURS: '12' } as Record<string, string>)[k]);
    const now = new Date('2026-11-20T03:00:00Z'); // Fri 08:30 IST
    const days = generateSlots(cfg, now);
    expect(days.map((d) => d.weekday)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI']);
    expect(days[0].slots.map((s) => s.toISOString())).toEqual([
      '2026-11-23T04:30:00.000Z', '2026-11-23T05:00:00.000Z', '2026-11-23T05:30:00.000Z', '2026-11-23T06:00:00.000Z',
    ]);
    expect(days.every((d) => d.slots.every((s) => s.getTime() >= now.getTime() + 12 * 3600_000))).toBe(true);
  });

  it('rejects an invalid time zone', () => {
    expect(() => parseSlotConfig((k) => (k === 'DEMO_TIMEZONE' ? 'Mars/Olympus' : undefined))).toThrow(/not a valid IANA/);
  });
});
