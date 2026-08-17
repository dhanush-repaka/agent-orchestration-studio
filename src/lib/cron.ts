const EVERY = /^every\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours)$/i;

export function scheduleIntervalMs(expr: string): number | null {
  const trimmed = expr.trim();
  const every = trimmed.match(EVERY);
  if (every) {
    const n = Number(every[1]);
    const unit = every[2].toLowerCase();
    if (!Number.isFinite(n) || n <= 0) return null;
    if (unit.startsWith('h')) return n * 60 * 60 * 1000;
    return n * 60 * 1000;
  }
  return null;
}

/** 5-field cron: minute hour day-of-month month day-of-week. Supports * and a single number per field. */
export function cronMatches(expr: string, at: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const min = at.getUTCMinutes();
  const hour = at.getUTCHours();
  const day = at.getUTCDate();
  const month = at.getUTCMonth() + 1;
  const dow = at.getUTCDay();
  const values = [min, hour, day, month, dow];
  return parts.every((field, i) => field === '*' || Number(field) === values[i]);
}

export function isScheduleDue(expr: string, lastScheduledAt: string | undefined, now: Date): boolean {
  const trimmed = expr?.trim();
  if (!trimmed) return false;
  const last = lastScheduledAt ? new Date(lastScheduledAt).getTime() : 0;
  if (Number.isNaN(last)) return false;
  const interval = scheduleIntervalMs(trimmed);
  if (interval != null) {
    return now.getTime() - last >= interval;
  }
  if (!cronMatches(trimmed, now)) return false;
  const elapsed = now.getTime() - last;
  return elapsed >= 50_000;
}
