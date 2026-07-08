// Kyrgyzstan is fixed UTC+6 (no DST) — a plain offset is safe and keeps the
// «one trip per route per day» window aligned with the calendar users see.
const BISHKEK_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** [start, end) of the Asia/Bishkek calendar day containing `date`, in UTC. */
export function bishkekDayRange(date: Date): { start: Date; end: Date } {
  const startMs = Math.floor((date.getTime() + BISHKEK_OFFSET_MS) / DAY_MS) * DAY_MS - BISHKEK_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}
