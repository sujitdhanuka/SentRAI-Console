/**
 * Demo-slot arithmetic in the sales team's time zone, with no date library:
 * Intl gives the zone's offset at any instant, which is enough to turn
 * "Tuesday 10:30 in Asia/Kolkata" into a UTC instant (DST-safe).
 */
export interface SlotConfig {
  timezone: string;
  startMinute: number; // minutes after midnight, local
  endMinute: number;
  slotMinutes: number;
  weekdays: number[]; // 0 = Sunday
  windowDays: number;
  minNoticeHours: number;
}

const DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function parseSlotConfig(env: (k: string) => string | undefined): SlotConfig {
  const tz = env('DEMO_TIMEZONE')?.trim() || 'Asia/Kolkata';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { throw new Error(`DEMO_TIMEZONE "${tz}" is not a valid IANA time zone`); }
  const hours = (env('DEMO_HOURS')?.trim() || '10:00-18:00').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  const startMinute = hours ? +hours[1] * 60 + +hours[2] : 600;
  const endMinute = hours ? +hours[3] * 60 + +hours[4] : 1080;
  const slotMinutes = Math.min(120, Math.max(15, Number(env('DEMO_SLOT_MINUTES')) || 30));
  const days = (env('DEMO_DAYS')?.trim() || 'MON,TUE,WED,THU,FRI').toUpperCase().split(/[\s,]+/).map((d) => DAY.indexOf(d.slice(0, 3))).filter((d) => d >= 0);
  return {
    timezone: tz,
    startMinute,
    endMinute: Math.max(endMinute, startMinute + slotMinutes),
    slotMinutes,
    weekdays: days.length ? days : [1, 2, 3, 4, 5],
    windowDays: Math.min(60, Math.max(1, Number(env('DEMO_WINDOW_DAYS')) || 14)),
    minNoticeHours: Math.max(0, Number(env('DEMO_MIN_NOTICE_HOURS') ?? 12) || 0),
  };
}

/** Wall-clock parts of an instant in a zone. */
function wall(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

function offsetMinutes(date: Date, tz: string): number {
  const w = wall(date, tz);
  return Math.round((Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - date.getTime()) / 60000);
}

/** UTC instant for a local wall-clock time in `tz`. */
export function zonedToUtc(y: number, m: number, d: number, minuteOfDay: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  let off = offsetMinutes(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = offsetMinutes(new Date(t), tz);
  if (off2 !== off) { off = off2; t = guess - off * 60000; }
  return new Date(t);
}

export interface DaySlots { date: string; weekday: string; slots: Date[] }

/** Every bookable slot start in the window (before removing booked ones). */
export function generateSlots(cfg: SlotConfig, now: Date = new Date()): DaySlots[] {
  const today = wall(now, cfg.timezone);
  const earliest = now.getTime() + cfg.minNoticeHours * 3600_000;
  const out: DaySlots[] = [];
  for (let i = 0; i <= cfg.windowDays; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    const wd = day.getUTCDay();
    if (!cfg.weekdays.includes(wd)) continue;
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const slots: Date[] = [];
    for (let min = cfg.startMinute; min + cfg.slotMinutes <= cfg.endMinute; min += cfg.slotMinutes) {
      const at = zonedToUtc(y, m, d, min, cfg.timezone);
      if (at.getTime() >= earliest) slots.push(at);
    }
    if (slots.length) out.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, weekday: DAY[wd], slots });
  }
  return out;
}
