/** Sanity tests for the chapter-order normalizer. Run: bun scripts/test-chapter-order.ts */
import { parseChapterKey, normalizeChapters, formatChapterNumber } from "../src/lib/chapter-order";
import type { ChapterEntry } from "../src/lib/sources/types";

let failures = 0;
function expectKey(label: string, vol: number | null, num: number | null) {
  const got = parseChapterKey(label);
  const ok = got.volume === vol && got.number === num;
  if (!ok) {
    failures++;
    console.log(`FAIL parse "${label}" → {vol:${got.volume}, num:${got.number}}  expected {vol:${vol}, num:${num}}`);
  }
}

// ── parsing ──────────────────────────────────────────────────────────────
expectKey("Vol.2 Chapter 17: The Beginning", 2, 17);
expectKey("Chapter 12.5", null, 12.5);
expectKey("第45话", null, 45);
expectKey("第12章", null, 12);
expectKey("Capítulo 34", null, 34);
expectKey("#12", null, 12);
expectKey("v01c005", 1, 5);
expectKey("12", null, 12);
expectKey("12.5", null, 12.5);
expectKey("One Piece 1044", null, 1044);
expectKey("Oneshot", null, null);
expectKey("Volume 5 Extras", 5, null);
expectKey("Chapter 10-12", null, 10);
expectKey("Episode 8", null, 8);
expectKey("Ch. 5", null, 5);
expectKey("Chapter 12 (2023-05-01)", null, 12);
expectKey("Naruto (2002) 245", null, 245);
expectKey("Ep 7 v2", null, 7);
expectKey("Vol. 3 Chapter 25.5", 3, 25.5);
expectKey("ch_12", null, 12);
expectKey("Chapter 88 — Title", null, 88);
expectKey("5 cm poster", null, null); // bonus-free label, fallback takes LAST number → 5? ("5" only) hmm
expectKey("Sect Master 12", null, 12);
expectKey("第2卷 第30话", 2, 30);

// ── formatting ───────────────────────────────────────────────────────────
for (const [n, s] of [[12, "12"], [12.5, "12.5"], [12.0, "12"], [12.25, "12.25"]] as const) {
  if (formatChapterNumber(n) !== s) {
    failures++;
    console.log(`FAIL format ${n} → ${formatChapterNumber(n)} expected ${s}`);
  }
}

// ── normalizeChapters ────────────────────────────────────────────────────
const ch = (id: string, label: string, lang?: string): ChapterEntry => ({ id, label, lang });

// random/date order in → strict ascending out, deduped, EN preferred
{
  const input = [
    ch("a", "Chapter 10", "EN"),
    ch("b", "Chapter 5", "JA"),
    ch("c", "Chapter 5", "EN"),
    ch("d", "Chapter 5 — special cover", "EN"), // same num+lang as c → first kept... (c)
    ch("e", "Vol.2 Chapter 1", "EN"),
    ch("f", "Oneshot"),
    ch("g", "Chapter 2 Part 2", "EN"),
    ch("h", "Chapter 2", "EN"),
  ];
  const out = normalizeChapters(input, true);
  const nums = out.chapters.map((c) => c.num);
  const ids = out.chapters.map((c) => c.id);
  // main winners (before the parts/unnumbered tail) must be strictly ascending
  const winnerNums = nums.slice(0, 4);
  const ascending = winnerNums.every((n, i) => i === 0 || (n ?? Infinity) >= (winnerNums[i - 1] ?? Infinity));
  if (!ascending) { failures++; console.log("FAIL order", ids, nums); }
  // expected winners: 1(e) 2(h) 5(c) 10(a) then part-chapters by number (g: 2), then unnumbered (f)
  const expectIds = ["e", "h", "c", "a", "g", "f"];
  if (JSON.stringify(ids) !== JSON.stringify(expectIds)) {
    failures++; console.log("FAIL winner/dedupe order:", ids, "expected", expectIds);
  }
  if (out.maxNumber !== 10) { failures++; console.log("FAIL maxNumber", out.maxNumber); }
}

// file list (not readable) — order untouched
{
  const input = [ch("f1", "PDF"), ch("f2", "EPUB"), ch("f3", "CBZ")];
  const out = normalizeChapters(input, false);
  if (out.sortedByNumber || out.chapters.map((c) => c.id).join() !== "f1,f2,f3") {
    failures++; console.log("FAIL file list should keep order", out.chapters);
  }
}

// titled-only list (below trust ratio) — untouched
{
  const input = [ch("n1", "The Beginning"), ch("n2", "The Middle"), ch("n3", "The End"), ch("n4", "Wow 7")];
  const out = normalizeChapters(input, true);
  if (out.sortedByNumber) { failures++; console.log("FAIL titled list should keep order"); }
}

// 60% trust: mostly numbered → sorted
{
  const input = [
    ch("m3", "Chapter 3"), ch("m1", "Chapter 1"), ch("m2", "Chapter 2"), ch("mx", "Omake"),
  ];
  const out = normalizeChapters(input, true);
  const ids = out.chapters.map((c) => c.id).join();
  if (ids !== "m1,m2,m3,mx") { failures++; console.log("FAIL mixed order:", ids); }
}

// chapter TITLES containing "Party"/"p" words must not be exempted from dedupe
// (regression: One Piece "Vol.81 Ch.813 - The Tea Party" landed unsorted at the end)
{
  const input = [
    ch("t3", "One Piece Vol.TBE Ch.1197"),
    ch("t2", "One Piece Vol.81 Ch.813 - The Tea Party"),
    ch("t1", "One Piece Vol.TBE Ch.002.3"),
  ];
  const out = normalizeChapters(input, true);
  const ids = out.chapters.map((c) => c.id).join();
  if (ids !== "t1,t2,t3") { failures++; console.log("FAIL tea-party order:", ids); }
}

// "Chapter 5 Part 1/2" both survive dedupe, sorted by their number
{
  const input = [
    ch("p2", "Chapter 5 Part 2"), ch("p1", "Chapter 5 Part 1"), ch("p0", "Chapter 4"),
  ];
  const out = normalizeChapters(input, true);
  const ids = out.chapters.map((c) => c.id).join();
  if (ids !== "p0,p1,p2") { failures++; console.log("FAIL part order:", ids); }
}

if (failures === 0) console.log("ALL CHAPTER-ORDER TESTS PASSED");
else { console.log(`${failures} FAILURES`); process.exit(1); }
