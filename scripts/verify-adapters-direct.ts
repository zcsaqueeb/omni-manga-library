/** Direct adapter-level check: search → details → assert ascending chapter
 * numbers. Bypasses HTTP/unified limits/negative caches.
 * Run: bun scripts/verify-adapters-direct.ts [sourceId ...] */
import { SOURCES } from "../src/lib/sources";
import { normalizeChapters, parseChapterKey } from "../src/lib/chapter-order";

const wanted = process.argv.slice(2);
const queries: Record<string, string> = {
  mangadex: "chainsaw man",
comick: "one piece", mangasee: "one piece", manganato: "one piece",
  chapmanga: "one piece", mangakakalot: "one piece", mangahere: "one piece",
  weebcentral: "one piece", mangafire: "one piece",
  kunmanga: "solo leveling", manhuaplus: "martial peak", asurascans: "solo max level newbie",
  royalroad: "primal hunter", lightnovelpub: "shadow slave", novelbin: "shadow slave",
  scribblehub: "ultimate being", mtnovel: "martial peak",
};
const DEFAULT_Q = "solo leveling";

let bad = 0;
for (const adapter of SOURCES) {
  if (wanted.length && !wanted.includes(adapter.id)) continue;
  if (!adapter.chapterPages) continue; // file-only sources: no chapter ordering
  const q = queries[adapter.id] ?? DEFAULT_Q;
  try {
    const s = await adapter.search(q, 1, 10).catch((e: Error) => {
      console.log(`!    ${adapter.id.padEnd(14)} search threw: ${String(e?.message ?? e).slice(0, 110)}`);
      return null;
    });
    const s0 = s?.items ?? [];
    const ql = q.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const hit =
      s0.find((i) => i.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim() === ql) ??
      s0.find((i) => i.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").includes(ql)) ??
      s0[0];
    if (!hit) {
      console.log(`?    ${adapter.id.padEnd(14)} search no results ("${q}")`);
      continue;
    }
    const d = await adapter.details(hit.id.split(":").slice(1).join(":"));
    // mirror /api/details: normalize (dedupe + strict ascending by number)
    const norm = normalizeChapters(d.chapters, d.readable);
    const chapters = norm.chapters;
    const nums = chapters.map((c) => c.num ?? parseChapterKey(c.label).number);
    let firstDesc = -1;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] !== null && nums[i - 1] !== null && (nums[i] as number) < (nums[i - 1] as number)) { firstDesc = i; break; }
    }
    const seen = new Set<string>();
    let dup = false;
    for (const c of chapters) {
      const k = `${c.num ?? parseChapterKey(c.label).number}|${(c.lang ?? "").toLowerCase()}`;
      if (c.num !== undefined && seen.has(k)) { dup = true; break; }
      seen.add(k);
    }
    const ok = firstDesc === -1 && !dup;
    if (!ok) bad++;
    const at = (i: number) => (chapters[i] ? `#${chapters[i].num ?? "?"} "${chapters[i].label.slice(0, 34)}"` : "-");
    console.log(
      `${ok ? "OK  " : "FAIL"} ${adapter.id.padEnd(14)} raw=${d.chapters.length} n=${String(chapters.length).padStart(4)} latest=${d.latest ?? "-"}\n` +
      `     [0]=${at(0)}  [mid]=${at(Math.floor(chapters.length / 2))}  [last]=${at(chapters.length - 1)}` +
      (firstDesc >= 0 ? `  ← descends at #${firstDesc}: ${chapters[firstDesc - 1].label.slice(0, 30)} → ${chapters[firstDesc].label.slice(0, 30)}` : ""),
    );
  } catch (err) {
    console.log(`ERR  ${adapter.id.padEnd(14)} ${(err as Error).message.slice(0, 100)}`);
  }
}
console.log(bad === 0 ? "\nADAPTER ORDER OK" : `\n${bad} ADAPTER(S) BAD`);
process.exit(bad === 0 ? 0 : 1);
