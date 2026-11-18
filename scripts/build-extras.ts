/**
 * Builds src/core/extras-data.ts — the curated daily-life-guidance verses and hadith quoted under
 * reminders (Canvas `Extra:`). Text is fetched verbatim from free, keyless sources, never typed by hand:
 *   verses -> api.alquran.cloud  Arabic (quran-uthmani) + Urdu (ur.kanzuliman, Kanzul Iman — Ahmed Raza Khan)
 *   hadith -> fawazahmed0 hadith-api  Urdu only (urd-bukhari / urd-muslim), the Prophet's ﷺ words
 *             extracted from the narration (the chain of narrators is dropped)
 *
 * Only SHORT entries are kept (see MAX_*): a reminder should be glanceable, not a paragraph.
 * Candidates over the limit are skipped automatically, so it's fine to list generously.
 *
 * To add or remove an entry: edit the ref lists below, then `npm run build:extras` and review the diff.
 */
import { promises as fs } from "node:fs";

/** Qur'an refs ("surah:ayah") — guidance for everyday conduct.
 * Reviewed out: 23:96 (2nd half is about disbelievers), 31:19 (ends "the donkey's voice"), 108:2 (Eid sacrifice). */
const VERSES = [
  "2:43", "2:45", "2:110", "2:152", "2:153", "2:195", "2:222", "2:263", "3:92", "3:134", "3:139",
  "3:200", "4:86", "7:31", "7:56", "7:199", "8:46", "9:119", "11:115", "13:28", "14:7", "16:128",
  "17:24", "17:36", "17:37", "17:53", "20:25", "20:26", "20:114", "22:77", "24:22",
  "25:63", "28:24", "29:45", "29:69", "31:18", "33:41", "33:42", "33:70", "40:60",
  "41:34", "42:43", "49:10", "51:56", "53:39", "55:60", "57:23", "61:2", "64:16", "73:8",
  "87:14", "87:15", "93:11", "94:5", "94:7", "94:8",
]

/** Hadith on daily life. Bukhari: standard numbers. Muslim: the commonly cited (Arabic) number. */
// Reviewed out: 10 & 6024 (Urdu text isn't the saying), 39 (translator commentary), 6136/6138 (dupes of 6018).
const BUKHARI = [
  13, 2072, 2989, 5373, 5376, 6012, 6013, 6015, 6018, 6021, 6026, 6035, 6114, 6116, 6117, 6125,
  6407, 6412, 6416, 6446, 6464,
];
// Reviewed out: 55 (fragment).
// Cited number -> this API's per-file number (its Muslim files are a running sequence; mapped once
// via `arabicnumber` in editions/eng-muslim.min.json).
const MUSLIM: Record<number, number> = {
  2553: 6516, 2563: 6536, 2564: 6541, 2585: 6585, 2586: 6586, 2588: 6592, 2590: 6594,
  2593: 6601, 2594: 6602, 2626: 6690, 2664: 6774, 2734: 6932, 2999: 7500,
};

/** Character limits (≈ one Slack line on desktop). */
const MAX_VERSE_ARABIC = 110;
const MAX_VERSE_URDU = 110;
const MAX_HADITH_URDU = 120;
const QURAN = "https://api.alquran.cloud/v1/ayah";
const HADITH = "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions";
// jsDelivr only serves files it already has cached (the repo exceeds its 150 MB package limit);
// the same files are on GitHub directly.
const HADITH_GITHUB = "https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions";

interface Entry {
  arabic?: string;
  urdu: string;
  ref: string;
}

async function getJson<T>(url: string, maxAttempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return (await res.json()) as T;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= maxAttempts) throw new Error(`${url}: ${err instanceof Error ? err.message : err}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt)); // network blips / CDN 403s
    }
  }
}

const clean = (s: string): string =>
  s
    .replace(/[\u200e\u200f]/g, "") // invisible direction marks
    .replace(/\s+/g, " ")
    .replace(/\s+([،۔,.!؟?])/g, "$1") // "ہے ،" -> "ہے،"
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")") // "( اینٹ )" -> "(اینٹ)"
    .trim();

/**
 * The Prophet's ﷺ words from an Urdu narration: the first quoted span (” “ or "), or the text after
 * the last "فرمایا" when it isn't quoted. Null if neither is found (it's a narrator's description).
 */
export function extractSaying(urdu: string): string | null {
  const saying = rawSaying(clean(urdu));
  // Drop a leftover connector from the narration: "کہ غصہ نہ کر" / "کرتے تھے کہ تم میں ..." -> the words only.
  // ...and a narrator's afterword ("چنانچہ اس کے بعد میں ...") that follows the words.
  return saying ? saying.replace(/^.{0,15}?کہ\s+/, "").replace(/\s*چنانچہ .*$/, "").trim() : null;
}

function rawSaying(t: string): string | null {
  const open = t.search(/["“”]/);
  if (open !== -1) {
    const rest = t.slice(open + 1);
    const close = rest.search(/["“”]/);
    const saying = (close === -1 ? rest : rest.slice(0, close)).trim();
    if (saying.length >= 15) return saying.replace(/^[:،\s]+/, "");
  }
  const said = t.lastIndexOf("فرمایا");
  if (said !== -1) {
    const saying = t.slice(said + "فرمایا".length).replace(/^[\s:،]+/, "").trim();
    if (saying.length >= 15) return saying;
  }
  return null;
}

async function buildVerses(): Promise<Entry[]> {
  // One small request per verse (both editions at once), a few in parallel — robust on slow links.
  type Ayah = { data: Array<{ text: string; edition: { identifier: string } }> };
  const fetched = await mapLimit(VERSES, 6, (ref) =>
    getJson<Ayah>(`${QURAN}/${ref}/editions/quran-uthmani,ur.kanzuliman`),
  );

  const out: Entry[] = [];
  VERSES.forEach((ref, i) => {
    const data = fetched[i]!.data;
    const arabicRaw = data.find((d) => d.edition.identifier === "quran-uthmani")?.text;
    const urduRaw = data.find((d) => d.edition.identifier === "ur.kanzuliman")?.text;
    if (!arabicRaw || !urduRaw) throw new Error(`verse ${ref} not found`);
    // Kanzul Iman ends mid-flow verses with "،" or "-"; a standalone quote reads better without it.
    const arabic = clean(arabicRaw).replace(/^بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\s*/, "");
    const urdu = clean(urduRaw).replace(/[\s،,\-–]+$/, "");
    if (arabic.length > MAX_VERSE_ARABIC || urdu.length > MAX_VERSE_URDU) {
      console.warn(`skip verse ${ref}: too long (ar ${arabic.length}, ur ${urdu.length})`);
      return;
    }
    out.push({ arabic, urdu, ref: `Qur'an ${ref}` });
  });
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function buildHadith(): Promise<Entry[]> {
  const out: Entry[] = [];
  const add = (label: string, num: number, text: string | undefined): void => {
    const saying = text ? extractSaying(text) : null;
    if (!saying) return void console.warn(`skip ${label} ${num}: no quoted saying found`);
    if (saying.length > MAX_HADITH_URDU) return void console.warn(`skip ${label} ${num}: too long (${saying.length})`);
    out.push({ urdu: saying, ref: `${label} ${num}` });
  };

  // One small file per hadith (the whole-book files are several MB — too slow on a weak link).
  type One = { hadiths: Array<{ text: string }> };
  const jobs: Array<[label: string, cited: number, url: string]> = [
    ...BUKHARI.map((n): [string, number, string] => ["Sahih al-Bukhari", n, `${HADITH}/urd-bukhari/${n}.json`]),
    ...Object.entries(MUSLIM).map(([cited, file]): [string, number, string] => [
      "Sahih Muslim",
      Number(cited),
      `${HADITH}/urd-muslim/${file}.json`,
    ]),
  ];
  const fetched = await mapLimit(jobs, 6, ([, , url]) =>
    getJson<One>(url, 1).catch(() => getJson<One>(url.replace(HADITH, HADITH_GITHUB))),
  );
  jobs.forEach(([label, cited], i) => add(label, cited, fetched[i]!.hadiths[0]?.text));
  return out;
}

const verses = await buildVerses();
const hadith = await buildHadith();

const file = `/**
 * GENERATED by scripts/build-extras.ts — do not hand-edit (re-run \`npm run build:extras\`).
 * Daily-life guidance quoted under reminders (Canvas \`Extra:\`).
 * Verses: Arabic (Uthmani) + Urdu (Kanzul Iman — Ahmed Raza Khan) via api.alquran.cloud.
 * Hadith: Urdu via fawazahmed0/hadith-api (the Prophet's ﷺ words, chain of narrators omitted).
 */
import type { Extra } from "./types";

export const EXTRA_VERSES: Extra[] = ${JSON.stringify(verses, null, 2)};

export const EXTRA_HADITH: Extra[] = ${JSON.stringify(hadith, null, 2)};
`;
await fs.writeFile("src/core/extras-data.ts", file);
console.log(`wrote src/core/extras-data.ts: ${verses.length} verses, ${hadith.length} hadith`);
