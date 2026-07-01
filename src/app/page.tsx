import { loadConfig } from "@/core/config";
import { readCanvas } from "@/core/slack";
import { parseCanvas } from "@/core/canvas";
import { getLocalParts, to12Hour } from "@/core/time";
import { isWeekend, isHoliday } from "@/core/calendar";
import { readMarker, makeKey } from "@/core/dedupe";
import { prayerLabel } from "@/core/message";
import type { PrayerSlot } from "@/core/types";
import type { ReactNode } from "react";

// Always re-read the live Canvas on view — never cache a stale schedule.
export const dynamic = "force-dynamic";

export default async function Page() {
  let body: ReactNode;
  try {
    body = await Dashboard();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    body = (
      <div className="card">
        <h2>Not configured</h2>
        <p className="muted">
          The dashboard needs the same environment variables as the engine (see{" "}
          <code>.env.example</code>). The reminders themselves run on GitHub Actions and do not
          depend on this page.
        </p>
        <p className="error">{msg}</p>
      </div>
    );
  }

  return (
    <main>
      <h1>🕌 Namaz Reminder</h1>
      <p className="sub">Live status of the Slack reminder engine (runs on GitHub Actions).</p>
      {body}
    </main>
  );
}

async function Dashboard() {
  const config = loadConfig(process.env);
  const now = new Date();
  const local = getLocalParts(now, config.timezone);

  const { raw, editTimestamp } = await readCanvas(config);
  const schedule = parseCanvas(raw, {
    fallbackOffset: config.defaultOffsetMin,
    defaultWeekend: config.weekendDays,
  });
  const marker = await readMarker(config.stateDir, local.dateKey);
  const enabled = schedule.prayers.filter((p) => p.enabled);

  const skipReason = !config.remindersEnabled
    ? "kill switch off (REMINDERS_ENABLED=false)"
    : schedule.status === "off"
      ? "Canvas Status: OFF"
      : isWeekend(local.weekday, schedule.weekendDays)
        ? "weekend"
        : isHoliday(local.dateKey, schedule.holidays)
          ? "holiday"
          : null;

  const next = nextUpcoming(enabled, local.minutesSinceMidnight);

  return (
    <>
      <div className="card">
        <h2>Today — {local.dateKey}</h2>
        <p>
          Status:{" "}
          {skipReason ? (
            <span className="pill off">paused · {skipReason}</span>
          ) : (
            <span className="pill on">active</span>
          )}
        </p>
        <p className="muted">
          Now {String(local.hour).padStart(2, "0")}:{String(local.minute).padStart(2, "0")}{" "}
          {config.timezone}
          {next ? (
            <>
              {" · "}next: <strong>{prayerLabel(next.key)}</strong> at {to12Hour(next.time)} (reminder{" "}
              {next.offsetMin} min before)
            </>
          ) : (
            " · no more reminders today"
          )}
        </p>
      </div>

      <div className="card">
        <h2>Prayers</h2>
        <table>
          <thead>
            <tr>
              <th>Prayer</th>
              <th>Time</th>
              <th>Lead</th>
              <th>Sent today</th>
              <th>Note / message</th>
            </tr>
          </thead>
          <tbody>
            {enabled.map((p) => (
              <tr key={p.key}>
                <td>{prayerLabel(p.key)}</td>
                <td>{to12Hour(p.time)}</td>
                <td>{p.offsetMin} min</td>
                <td>{marker[makeKey(p.key, p.time)] ? "✅" : "—"}</td>
                <td className="muted">{p.template ?? p.note ?? ""}</td>
              </tr>
            ))}
            {enabled.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No enabled prayers in the Canvas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Details</h2>
        <p className="muted">Weekend: {schedule.weekendDays.map(dayName).join(", ") || "none"}</p>
        <p className="muted">
          Holidays: {schedule.holidays.length ? schedule.holidays.join(", ") : "none"}
        </p>
        <p className="muted">
          Canvas last edited:{" "}
          {editTimestamp ? new Date(editTimestamp * 1000).toUTCString() : "unknown"}
        </p>
        {schedule.errors.length > 0 && (
          <p className="error">{`Parse errors:\n${schedule.errors.join("\n")}`}</p>
        )}
      </div>
    </>
  );
}

function nextUpcoming(prayers: PrayerSlot[], nowMinutes: number): PrayerSlot | null {
  const upcoming = prayers
    .filter((p) => p.minutes - p.offsetMin >= nowMinutes)
    .sort((a, b) => a.minutes - b.minutes);
  return upcoming[0] ?? null;
}

function dayName(d: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d] ?? String(d);
}
