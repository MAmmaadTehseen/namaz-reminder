/**
 * Reminder message text. IMPORTANT: `@here` must be the literal Slack broadcast token
 * `<!here>` — a plain "@here" string does NOT notify anyone.
 *
 * Per prayer, the Canvas can customise the message:
 *   asr = 17:00 | on second floor          -> note appended to the standard message
 *   asr = 17:00 | note=on second floor      -> same, explicit
 *   asr = 17:00 | msg=Asr at {time} on 2F   -> full template ({time} {time24} {prayer} substituted)
 * The bot always guarantees the <!here> ping, prepending it if a template omits it.
 *
 * With `Extra:` on, a verse (Arabic + Urdu) or hadith (Urdu) is quoted under the reminder:
 *   <!here> Asr at 05:00 PM
 *   > فَٱذْكُرُونِىٓ أَذْكُرْكُمْ ...
 *   > سو تم مجھے یاد کرو۔ میں تمہیں یاد کیا کروں گا۔ ...
 *   > — _Qur'an 2:152_
 */
import type { Extra, PrayerSlot } from "./types";
import { to12Hour } from "./time";

const HERE = "<!here>";

/** Title-case a prayer key for display: "zuhr" -> "Zuhr", "isha" -> "Isha". */
export function prayerLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function formatReminder(prayer: PrayerSlot, footer?: string, extra?: Extra | null): string {
  const label = prayerLabel(prayer.key);
  const at12 = to12Hour(prayer.time);

  let body: string;
  if (prayer.template) {
    const rendered = prayer.template
      .replace(/\{time\}/gi, at12)
      .replace(/\{time24\}/gi, prayer.time)
      .replace(/\{prayer\}/gi, label);
    body = rendered.includes(HERE) ? rendered : `${HERE} ${rendered}`;
  } else {
    // Matches the team's manual style, e.g. "Zohr at 02:05 PM".
    const noteText = prayer.note ? ` — ${prayer.note}` : "";
    body = `${HERE} ${label} at ${at12}${noteText}`;
  }

  if (extra) body += `\n${formatExtra(extra)}`;

  const sig = footer?.trim();
  return sig ? `${body}\n_${sig}_` : body;
}

/** Slack quote block. Text is escaped so it can never form a <!channel>-style token. */
export function formatExtra(extra: Extra): string {
  const lines = [extra.arabic, extra.urdu].filter((l): l is string => !!l?.trim());
  return [...lines.map((l) => `> ${escapeSlack(l)}`), `> — _${escapeSlack(extra.ref)}_`].join("\n");
}

function escapeSlack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\s*\n\s*/g, " ");
}
