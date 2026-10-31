import { fetchHtml, html } from "../src/lib/http";

// fanfox parse debug
const h = await fetchHtml("https://fanfox.net/search?title=one+piece&page=1", { timeoutMs: 12_000, retries: 0 });
const doc = html(h);
const links = doc.links("/manga/", 20);
console.log("fanfox /manga/ links:", links.length, links.slice(0, 3).map((a) => a.href.slice(0, 60) + " || " + a.text.slice(0, 30)));

// asuracomic debug
try {
  const a = await fetchHtml("https://asuracomic.net/series?name=solo+max+level+newbie", { timeoutMs: 12_000, retries: 0 });
  console.log("asura len:", a.length, "series links:", [...a.matchAll(/href="([^"]*\/series\/[^"]*)"/gi)].length);
} catch (e) { console.log("asura ERR", String(e).slice(0, 90)); }

// reaper debug
try {
  const r = await fetchHtml("https://reaper-scans.com/?s=solo+leveling&post_type=wp-manga", { timeoutMs: 12_000, retries: 0 });
  const hits = [...r.matchAll(/href="([^"]*(?:\/series\/|\/comic\/|\/manga\/)[^"]*)"/gi)].slice(0, 3).map((m) => m[1].slice(0, 60));
  console.log("reaper len:", r.length, "hits:", hits.join(" ; ") || "none");
} catch (e) { console.log("reaper ERR", String(e).slice(0, 90)); }

// thunderscans debug
try {
  const t = await fetchHtml("https://thunderscans.com/?s=solo+leveling&post_type=wp-manga", { timeoutMs: 12_000, retries: 0 });
  const hits = [...t.matchAll(/href="([^"]*(?:\/series\/|\/comic\/|\/manga\/)[^"]*)"/gi)].slice(0, 3).map((m) => m[1].slice(0, 60));
  console.log("thunder len:", t.length, "hits:", hits.join(" ; ") || "none");
} catch (e) { console.log("thunder ERR", String(e).slice(0, 90)); }
