/**
 * CI entrypoint — run by GitHub Actions every 5 minutes: `npx tsx scripts/tick.ts`.
 * Loads config from env (Actions secrets) and runs one tick. Exits non-zero on error
 * so a failure shows a red X in the Actions UI.
 */
import { loadConfig } from "../src/core/config";
import { runTick } from "../src/core/pipeline";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const result = await runTick(config, new Date());
  console.log(JSON.stringify(result, null, 2));

  if (result.status === "error") {
    process.exitCode = 1;
    return;
  }
  const summary =
    result.status === "posted"
      ? `posted ${result.posted.length}: ${result.posted.join(", ")}`
      : result.status === "skipped"
        ? `skipped (${result.reason})`
        : "nothing due";
  console.log(`namaz-reminder: ${summary}${result.dryRun ? " [DRY_RUN]" : ""}`);
}

main().catch((err) => {
  console.error("namaz-reminder tick crashed:", err);
  process.exitCode = 1;
});
