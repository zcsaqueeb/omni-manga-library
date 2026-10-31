import { fetchJson, stripHtml } from "@/lib/http";
import { iaLangClause, LANGUAGES } from "@/lib/languages";
import type {
  ChapterEntry,
  Details,
  IAFileLike,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

/**
 * IA Audio Books — the Internet Archive's community audiobook shelves beyond
 * LibriVox: ~20k full audiobook readings, radio dramas and narrations in
 * dozens of languages (strong Hindi/Urdu/Tamil/Bengali pockets that LibriVox
 * doesn't carry). Driven through archive.org's search + metadata APIs:
 *   search  → advancedsearch  mediatype:(audio) AND subject/title:(audiobook)
 *   details → archive.org/metadata/{identifier}   (mp3 files carry track #s)
 *   audio   → archive.org/download/{identifier}/{file} — streams in the app
 *
 * LibriVox items are excluded (`!collection:librivoxaudio`) so the two
 * audiobook sources never duplicate each other.
 */

const SEARCH = "https://archive.org/advancedsearch.php";

const BASE_QUERY =
  "mediatype:(audio) AND !collection:(librivoxaudio) AND (subject:(audiobook) OR title:(audiobook))";

interface IADoc {
  identifier: string;
  title?: string | string[];
  creator?: string | string[];
  year?: string;
  date?: string;
  language?: string | string[];
  downloads?: number;
  description?: string | string[];
}

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/** "hin" → "Hindi" when we know the language, else undefined. */
function langTag(codes?: string | string[]): string | undefined {
  const c = first(codes)?.toLowerCase();
  if (!c) return undefined;
  return LANGUAGES.find((l) => l.ia === c || l.code === c)?.label;
}

function toItem(d: IADoc): MediaItem {
  const creator = first(d.creator);
  const lang = langTag(d.language);
  return {
    id: `ia-audio:${d.identifier}`,
    type: "audiobook",
    source: "ia-audio",
    sourceLabel: "IA Audio Books",
    title: (first(d.title) ?? d.identifier).replace(/_/g, " "),
    subtitle: creator,
    authors: creator ? [creator.replace(/\s*\(.*?\)\s*$/, "")] : [],
    cover: `https://archive.org/services/img/${d.identifier}`,
    year: d.year ? Number(d.year) || undefined : undefined,
    description: stripHtml(first(d.description), 500),
    tags: lang ? ["audiobook", lang] : ["audiobook"],
    externalUrl: `https://archive.org/details/${d.identifier}`,
  };
}

function qEscape(s: string) {
  return s.replace(/[:\\]/g, " ").trim();
}

async function iaSearch(query: string, page: number, limit: number): Promise<SearchResult> {
  const qs = new URLSearchParams({
    q: query,
    rows: String(limit),
    page: String(page),
    output: "json",
  });
  for (const f of ["identifier", "title", "creator", "year", "date", "language", "downloads", "description"]) {
    qs.append("fl[]", f);
  }
  qs.append("sort[]", "downloads desc");
  const data = await fetchJson<{ response?: { numFound?: number; docs?: IADoc[] } }>(
    `${SEARCH}?${qs}`,
    { timeoutMs: 12_000, retries: 1 },
  );
  const docs = data.response?.docs ?? [];
  return {
    items: docs.map(toItem),
    total: data.response?.numFound ?? docs.length,
    page,
    hasMore: page * limit < (data.response?.numFound ?? 0),
  };
}

/** IA length strings come as "640.61" (seconds) or "55:43" / "1:02:33" — minutes. */
function durMinutes(len?: string): number | undefined {
  if (!len) return undefined;
  if (len.includes(":")) {
    const parts = len.split(":").map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return undefined;
    const secs = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    return Math.round(secs / 60) || undefined;
  }
  const n = parseFloat(len);
  return Number.isFinite(n) ? Math.round(n / 60) || undefined : undefined;
}

const humanSize = (bytes?: string) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
};

interface MetaResponse {
  metadata?: {
    identifier?: string;
    title?: string | string[];
    creator?: string | string[];
    description?: string | string[];
    date?: string;
    year?: string;
    language?: string | string[];
    runtime?: string;
    publicdate?: string;
  };
  files?: IAFileLike[];
}

/** Browser-streamable audio only: mp3 (universal) + ogg (universal), never
 * .amr/.m4b/.flac — phones and desktop players must both just work. */
const PLAYABLE = /\.(mp3|ogg)$/i;
/** Higher rank = worse; prefer clean .mp3 originals over derivative .ogg. */
function fileRank(f: IAFileLike): number {
  return /\.ogg$/i.test(f.name) ? 1 : 0;
}

function prettyTrackName(f: IAFileLike): string {
  const base = (f.title || f.name).replace(/\.(mp3|ogg)$/i, "").replace(/[_-]+/g, " ").trim();
  return base || "Track";
}

export const iaAudio: SourceAdapter = {
  id: "ia-audio",
  label: "IA Audio Books",
  type: "audiobook",
  siteUrl: "https://archive.org/details/audiobooks",
  note: "Community audiobook archive — Hindi, Urdu & dozens more languages, plays in-app",

  async search(q, page, limit, _nsfw, lang) {
    const term = qEscape(q.slice(0, 80));
    const words = term.split(/\s+/).filter(Boolean).slice(0, 6);
    const termQ = words.length ? ` AND (title:(${words.join(" AND ")}) OR creator:(${words.join(" AND ")}))` : "";
    return iaSearch(`${BASE_QUERY}${termQ}${iaLangClause(lang)}`, page, Math.min(limit, 30));
  },

  async popular(page, limit, _nsfw, lang) {
    return iaSearch(`${BASE_QUERY}${iaLangClause(lang)}`, page, Math.min(limit, 30));
  },

  async details(realId) {
    const meta = await fetchJson<MetaResponse>(
      `https://archive.org/metadata/${encodeURIComponent(realId)}`,
      { timeoutMs: 15_000, retries: 1 },
    );
    const m = meta.metadata ?? {};

    // Items often carry the same track at several bitrates (VBR / 64kb / 128kb)
    // and as both .mp3 original + .ogg derivative — group by BASE NAME and keep
    // ONE copy per track, preferring the plain .mp3 original (sorted first).
    const audio = (meta.files ?? [])
      .filter((f) => PLAYABLE.test(f.name))
      .sort((a, b) => fileRank(a) - fileRank(b));
    const baseKey = (name: string) =>
      name.replace(/\.(mp3|ogg)$/i, "").replace(/[_-]*(?:64kb|128kb|vbr)[_-]*.*$/i, "") || name;
    const byTrack = new Map<string, IAFileLike>();
    for (const f of audio) {
      const key = baseKey(f.name);
      if (!byTrack.has(key)) byTrack.set(key, f);
    }

    const trackNo = (f: IAFileLike) => parseInt((f.track ?? "").split("/")[0] ?? "", 10) || 0;
    const tracks = [...byTrack.values()].sort(
      (a, b) => trackNo(a) - trackNo(b) || a.name.localeCompare(b.name, undefined, { numeric: true }),
    );

    const chapters: ChapterEntry[] = tracks.map((f) => ({
      id: `ia-audio-ch:${realId}:${f.name}`,
      label: prettyTrackName(f),
      seq: trackNo(f) || undefined,
      num: trackNo(f) || undefined,
      date: m.publicdate?.slice(0, 10),
      file: { ext: f.name.split(".").pop()!.toLowerCase(), size: humanSize(f.size) },
      pages: durMinutes(f.length), // minutes — shown as "N min" on audio rows
    }));

    // Whole-book ZIP — offered only when every track shares one IA format so
    // the archive.org/compress endpoint produces a predictable, complete zip.
    if (tracks.length >= 3) {
      const fmts = new Set(tracks.map((f) => (f.format ?? "").trim()).filter(Boolean));
      if (fmts.size === 1) {
        chapters.push({
          id: `ia-audio-zip:${realId}`,
          label: "Complete audiobook — single ZIP",
          file: { ext: "zip" },
        });
      }
    }

    const creator = first(m.creator);
    const lang = langTag(m.language);
    return {
      id: `ia-audio:${realId}`,
      type: "audiobook",
      source: "ia-audio",
      sourceLabel: "IA Audio Books",
      title: (first(m.title) ?? realId).replace(/_/g, " "),
      subtitle: creator,
      authors: creator ? [creator.replace(/\s*\(.*?\)\s*$/, "")] : [],
      description: stripHtml(first(m.description), 1400),
      publishedAt: m.date?.slice(0, 10),
      cover: `https://archive.org/services/img/${realId}`,
      externalUrl: `https://archive.org/details/${realId}`,
      status: m.runtime ? `Runtime ${m.runtime}` : `${tracks.length} tracks${lang ? ` · ${lang}` : ""}`,
      tags: lang ? ["audiobook", lang] : ["audiobook"],
      chapters,
      readable: true,
    } satisfies Details;
  },

  /** Returns the streamable mp3/ogg URL for one track. */
  async chapterPages(realId) {
    const sep = realId.indexOf(":");
    const identifier = realId.slice(0, sep);
    const fileName = realId.slice(sep + 1);
    if (!identifier || !fileName) throw new Error("Bad track id");
    return {
      audio: `https://archive.org/download/${encodeURIComponent(identifier)}/${fileName
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    };
  },
};
