/**
 * Reminder message text. IMPORTANT: `@here` must be the literal Slack broadcast token
 * `<!here>` — a plain "@here" string does NOT notify anyone.
 *
 * Per prayer, the Canvas can customise the message:
 *   asr = 17:00 | on second floor          -> note appended to the standard message
 *   asr = 17:00 | note=on second floor      -> same, explicit
 *   asr = 17:00 | msg=Asr at {time} on 2F   -> full template ({time} {time24} {prayer} substituted)
 * The bot always guarantees the <!here> ping, prepending it if a template omits it.
 */
import type { PrayerSlot } from "./types";
import { to12Hour } from "./time";

const HERE = "<!here>";

/** Title-case a prayer key for display: "zuhr" -> "Zuhr", "isha" -> "Isha". */
export function prayerLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function formatReminder(prayer: PrayerSlot): string {
  const label = prayerLabel(prayer.key);
  const at12 = to12Hour(prayer.time);

  if (prayer.template) {
    const rendered = prayer.template
      .replace(/\{time\}/gi, at12)
      .replace(/\{time24\}/gi, prayer.time)
      .replace(/\{prayer\}/gi, label);
    return rendered.includes(HERE) ? rendered : `${HERE} ${rendered}`;
  }

  const noteText = prayer.note ? ` — ${prayer.note}` : "";
  const lead = prayer.offsetMin > 0 ? ` (in ~${prayer.offsetMin} min)` : "";
  return `🕌 ${HERE} *${label}* namaz at *${at12}*${noteText}${lead}`;
}
