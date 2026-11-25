/**
 * Generates the creator-cover emoji catalog from the PINNED Unicode/CLDR data
 * in emojibase-data (exact devDependency, see package.json):
 *
 *   src/lib/coverEmoji.json                      what the picker shows (lazy-loaded)
 *   supabase/migrations/0008_community_covers.sql  the same keys, as the server allowlist
 *                                                (between the GENERATED markers)
 *
 *   npm run covers:emoji
 *
 * Kept: every standalone emoji in its normal (default) skin tone, including
 * flags and single composite (ZWJ) sequences, keyed by its fully-qualified
 * code-point sequence ("1F355", "1F3F3-FE0F-200D-1F308").
 * Left out, and only these:
 *   * the "component" group (skin-tone swatches, hair parts) and ungrouped
 *     regional-indicator letters: pieces, not emoji on their own;
 *   * skin-tone variants: covers use the normal tone only;
 *   * EXCLUDED below: the Emoji 16.0 additions, which many phones still draw as
 *     empty boxes. Re-include them by deleting the version cut once supported.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pkg = require("emojibase-data/package.json");
const data = require("emojibase-data/en/data.json");
const messages = require("emojibase-data/en/messages.json");

const MAX_EMOJI_VERSION = 15.1;
const COMPONENT_GROUP = 2;
/** Explicit exclusions by key, beyond the rules above. Deliberately empty. */
const EXCLUDED = new Set([]); // emojibase hexcodes

const groups = messages.groups.filter((g) => g.order !== COMPONENT_GROUP).sort((a, b) => a.order - b.order);
const groupIndex = new Map(groups.map((g, i) => [g.order, i]));
const title = (s) => s.replace(/(^|\s|&\s)(\S)/g, (m) => m.toUpperCase());

const kept = data
  .filter((e) => e.group !== undefined && e.group !== COMPONENT_GROUP && e.version <= MAX_EMOJI_VERSION && !EXCLUDED.has(e.hexcode))
  .sort((a, b) => a.order - b.order);
const leftOut = data.filter((e) => e.group !== undefined && e.group !== COMPONENT_GROUP && e.version > MAX_EMOJI_VERSION);

// The key is the fully-qualified sequence of the emoji as drawn (with FE0F where
// it needs emoji presentation), not emojibase's hexcode, which drops FE0F.
const keyOf = (emoji) => [...emoji].map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join("-");
for (const e of kept) {
  e.key = keyOf(e.emoji);
  if (!/^[0-9A-F]{4,6}(-[0-9A-F]{4,6}){0,9}$/.test(e.key)) throw new Error(`unexpected key ${e.key}`);
  if (String.fromCodePoint(...e.key.split("-").map((h) => parseInt(h, 16))) !== e.emoji) throw new Error(`key ${e.key} does not spell ${e.emoji}`);
}
if (new Set(kept.map((e) => e.key)).size !== kept.length) throw new Error("duplicate keys");

const catalog = {
  source: `emojibase-data@${pkg.version} (Unicode CLDR labels); Emoji ≤ ${MAX_EMOJI_VERSION}, normal skin tone`,
  groups: groups.map((g) => title(g.message)),
  // [key, label, group index, search words]. The emoji itself is derived from the key.
  emoji: kept.map((e) => [e.key, e.label, groupIndex.get(e.group), (e.tags ?? []).join(" ")]),
};
fs.writeFileSync(path.join(ROOT, "src/lib/coverEmoji.json"), JSON.stringify(catalog) + "\n");

const sqlPath = path.join(ROOT, "supabase/migrations/0008_community_covers.sql");
const sql = fs.readFileSync(sqlPath, "utf8");
const begin = "-- BEGIN GENERATED EMOJI ALLOWLIST (npm run covers:emoji)";
const end = "-- END GENERATED EMOJI ALLOWLIST";
const a = sql.indexOf(begin);
const b = sql.indexOf(end);
if (a < 0 || b < a) throw new Error("0008_community_covers.sql: generated-allowlist markers not found");
const rows = kept.map((e) => `('${e.key}')`);
const lines = [];
for (let i = 0; i < rows.length; i += 12) lines.push("  " + rows.slice(i, i + 12).join(", "));
const block = `${begin}\n-- ${kept.length} keys from ${catalog.source}.\nINSERT INTO public.community_cover_emoji (key) VALUES\n${lines.join(",\n")};\n`;
fs.writeFileSync(sqlPath, sql.slice(0, a) + block + sql.slice(b));

console.log(`cover emoji: ${kept.length} kept from ${data.length} (${leftOut.length} newer than Emoji ${MAX_EMOJI_VERSION} left out: ${leftOut.map((e) => e.emoji).join(" ")})`);
