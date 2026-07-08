/**
 * Manually send ONE sample reminder to verify posting works — without waiting for a prayer window.
 *
 * Safety: defaults to OWNER_ALERT_TARGET (your DM), NOT the live channel, so it never pings the team.
 * Override with TEST_TARGET=Cxxxx to post elsewhere on purpose.
 *
 *   npm run test:send            -> posts to your DM (OWNER_ALERT_TARGET)
 *   TEST_TARGET=Cxxxx npm run test:send
 */
import { loadConfig } from "../src/core/config";
import { postMessage } from "../src/core/slack";
import { formatReminder } from "../src/core/message";
import type { PrayerSlot } from "../src/core/types";

const config = loadConfig(process.env);
const target = process.env.TEST_TARGET || config.ownerAlertTarget || config.target;

const sample: PrayerSlot = {
  key: "zohr",
  time: "14:05",
  minutes: 14 * 60 + 5,
  offsetMin: 10,
  enabled: true,
};

const text = `🧪 Test — this is how reminders will look:\n${formatReminder(sample, config.footer)}`;

try {
  await postMessage(config.slackToken, target, text);
  console.log(`✅ Sent test message to ${target} (token: ${config.slackToken.slice(0, 5)}…).`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`❌ Test send failed: ${msg}`);
  if (/channel_not_found|not_in_channel/.test(msg)) {
    console.error(
      "   A bot can't post to your personal DM or a channel it hasn't joined.\n" +
        "   Use your user ID (U…) so the bot DMs you, or a channel the bot is invited to:\n" +
        "     TEST_TARGET=U0XXXX npm run test:send",
    );
  }
  process.exit(1);
}
