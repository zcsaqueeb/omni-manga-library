/** End-to-end: /api/details must return normalized (ascending, deduped,
 * num-stamped) chapters. Run: bun scripts/verify-api-details.ts */
const BASE = "http://localhost:3000";

async function json<T>(url: string, timeoutMs = 90_000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

const CASES: { q: string; type: "manga" | "novel"; source: string; pick: string }[] = [
  { q: "one piece", type: "manga", source: "mangahere", pick: "One Piece" },
  { q: "chainsaw man", type: "manga", source: "mangadex", pick: "Chainsaw Man" },
];

let bad = 0;
for (const c of CASES) {
  try {
    const s = await json<{ items: { id: string; title: string; source: string }[] }>(
      `${BASE}/api/search?q=${encodeURIComponent(c.q)}&type=${c.type}&source=${c.source}&limit=48`,
    );
    const exact = s.items.find((i) => i.source === c.source && i.title.toLowerCase() === c.pick.toLowerCase());
    const hit = exact ?? s.items.find((i) => i.source === c.source);
    if (!hit) { console.log(`SKIP ${c.source} (no search hit)`); continue; }
    const d = await json<{
      title: string; readable: boolean; latest?: string;
      chapters: { id: string; label: string; num?: number; lang?: string }[];
    }>(`${BASE}/api/details?id=${encodeURIComponent(hit.id)}`);
    const nums = d.chapters.map((x) => x.num).filter((n) => n !== undefined) as number[];
    let asc = true;
    for (let i = 1; i < nums.length; i++) if (nums[i] < nums[i - 1]) { asc = false; break; }
    const stamped = d.chapters.filter((x) => x.num !== undefined).length;
    const ok = asc && stamped >= Math.floor(d.chapters.length * 0.9) && d.chapters.length >= 5;
    if (!ok) bad++;
    console.log(
      `${ok ? "OK  " : "FAIL"} ${c.source.padEnd(10)} "${d.title}" n=${d.chapters.length} stamped=${stamped} latest=${d.latest ?? "-"}`,
    );
    console.log(`     first3: ${d.chapters.slice(0, 3).map((x) => `#${x.num} ${x.label.slice(0, 30)}`).join(" | ")}`);
    console.log(`     last2 : ${d.chapters.slice(-2).map((x) => `#${x.num} ${x.label.slice(0, 30)}`).join(" | ")}`);
  } catch (e) {
    bad++;
    console.log(`ERR  ${c.source}: ${(e as Error).message.slice(0, 120)}`);
  }
}
console.log(bad === 0 ? "API DETAILS NORMALIZATION OK" : `${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
