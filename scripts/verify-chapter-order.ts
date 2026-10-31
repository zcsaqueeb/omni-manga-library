/** Live verification: /api/details must return strictly ascending, deduped
 * chapter numbers for every readable source. Run: bun scripts/verify-chapter-order.ts */
import { parseChapterKey } from "../src/lib/chapter-order";

const BASE = "http://localhost:3000";
const WANTED: { source: string; query: string }[] = [
  { source: "mangadex", query: "one piece" },
  { source: "comick", query: "one piece" },
  { source: "mangasee", query: "one piece" },
  { source: "manganato", query: "one piece" },
  { source: "kunmanga", query: "solo leveling" },
  { source: "manhuaplus", query: "martial peak" },
  { source: "weebcentral", query: "one piece" },
  { source: "mangafire", query: "one piece" },
  { source: "royalroad", query: "primal hunter" },
  { source: "lightnovelpub", query: "shadow slave" },
];

async function json<T>(url: string, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

let bad = 0;
for (const w of WANTED) {
  try {
    const s = await json<{ items: { id: string; title: string; source: string }[] }>(
      `${BASE}/api/search?q=${encodeURIComponent(w.query)}&type=${w.source === "royalroad" || w.source === "lightnovelpub" ? "novel" : "manga"}&limit=60`,
    );
    const hit = s.items.find((i) => i.source === w.source);
    if (!hit) {
      console.log(`SKIP ${w.source.padEnd(12)} no item found for "${w.query}"`);
      continue;
    }
    const d = await json<{
      title: string;
      readable: boolean;
      latest?: string;
      chapters: { id: string; label: string; num?: number; lang?: string }[];
    }>(`${BASE}/api/details?id=${encodeURIComponent(hit.id)}`);

    const nums = d.chapters.map((c) => c.num ?? parseChapterKey(c.label).number);
    let asc = true;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] !== null && nums[i - 1] !== null && (nums[i] as number) < (nums[i - 1] as number)) { asc = false; break; }
    }
    const dupNums = new Set<string>();
    let dup = false;
    for (const c of d.chapters) {
      const k = `${c.num ?? parseChapterKey(c.label).number}|${(c.lang ?? "").toLowerCase()}`;
      if (c.num !== undefined && dupNums.has(k)) { dup = true; break; }
      dupNums.add(k);
    }
    const ok = asc && !dup;
    if (!ok) bad++;
    const head = d.chapters.slice(0, 3).map((c) => c.label.slice(0, 28)).join(" | ");
    const tail = d.chapters.slice(-2).map((c) => c.label.slice(0, 28)).join(" | ");
    console.log(
      `${ok ? "OK  " : "FAIL"} ${w.source.padEnd(12)} n=${String(d.chapters.length).padStart(4)} sorted=${asc} dup=${dup} latest=${d.latest ?? "-"}\n     head: ${head}\n     tail: ${tail}`,
    );
  } catch (err) {
    bad++;
    console.log(`ERR  ${w.source.padEnd(12)} ${(err as Error).message.slice(0, 120)}`);
  }
}
console.log(bad === 0 ? "\nALL LIVE CHECKS PASSED" : `\n${bad} CHECK(S) FAILED`);
process.exit(bad === 0 ? 0 : 1);
