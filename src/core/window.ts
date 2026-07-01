/**
 * The "should I send this reminder now?" window rule.
 *
 * For a prayer at `prayerMinutes` with lead time N (`offsetMin`), the reminder target
 * is Rp = prayerMinutes - N. We fire when `now` is inside the half-open catch-up window
 *   [Rp, prayerMinutes + graceMin]
 * i.e. from N minutes before the prayer, up to `graceMin` minutes AFTER the prayer time.
 *
 * Combined with a per-day dedupe marker (see dedupe.ts) this gives exactly-once delivery:
 * the first poll inside the window sends (~N before); if runs are dropped/delayed, a later
 * poll still catches it — but never after `prayer + grace`, so a passed time is never pinged late.
 */

export interface DueParams {
  /** minutes since local midnight, now. */
  nowMinutes: number;
  /** scheduled prayer time, minutes since local midnight. */
  prayerMinutes: number;
  /** lead time N (minutes before). */
  offsetMin: number;
  /** grace minutes after the prayer time during which a delayed run may still fire. */
  graceMin: number;
}

export function isDue({ nowMinutes, prayerMinutes, offsetMin, graceMin }: DueParams): boolean {
  const windowOpen = prayerMinutes - offsetMin;
  const windowClose = prayerMinutes + graceMin;
  return nowMinutes >= windowOpen && nowMinutes <= windowClose;
}
