import { fetchJson, stripHtml } from "@/lib/http";
import { iaLangClause } from "@/lib/languages";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

/**
 * LibriVox — the biggest free public-domain audiobook library (volunteer-
 * narrated classics), hosted on archive.org. Driven through archive.org's
 * search + metadata APIs (fuzzy search, popularity sort, reliable covers):
 *   search  → advancedsearch collection:librivoxaudio
 *   details → archive.org/metadata/{identifier}  (mp3 files carry track #s)
 *   audio   → archive.org/download/{identifier}/{file}
 */

const SEARCH = "https://archive.org/advancedsearch.php";
const AUDIO_COLLECTION = "librivoxaudio";

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

function itemUrl(identifier: string) {
  return `https://archive.org/details/${identifier}`;
}

function toItem(d: IADoc): MediaItem {
  const creator = first(d.creator);
  return {
    id: `librivox:${d.identifier}`,
    type: "audiobook",
    source: "librivox",
    sourceLabel: "LibriVox",
    title: (first(d.title) ?? d.identifier).replace(/, by .*/, "").replace(/_\d+$/, ""),
    subtitle: creator,
    authors: creator ? [creator] : [],
    cover: `https://archive.org/services/img/${d.identifier}`,
    year: d.year ? Number(d.year) : undefined,
    description: stripHtml(first(d.description), 500),
    tags: ["audiobook", "public domain"],
    externalUrl: itemUrl(d.identifier),
  };
}

async function iaSearch(query: string, page: number, limit: number, sort: string): Promise<SearchResult> {
  const qs = new URLSearchParams({
    q: query,
    rows: String(limit),
    page: String(page),
    output: "json",
  });
  for (const f of ["identifier", "title", "creator", "year", "date", "language", "downloads", "description"]) {
    qs.append("fl[]", f);
  }
  qs.append("sort[]", sort);
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

interface IAFile {
  name: string;
  title?: string;
  track?: string;
  format?: string;
  length?: string;
  size?: string;
}

interface IAMeta {
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
  files?: IAFile[];
}

const AUDIO_FORMAT = /MP3/i;
const humanSize = (bytes?: string) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
};

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

/** 64kb (LibriVox standard) first, then 128kb, then anything else. */
function fmtRank(fmt?: string): number {
  if (/64kbps/i.test(fmt ?? "")) return 0;
  if (/128kbps/i.test(fmt ?? "")) return 1;
  return 2;
}

function prettyTrackName(f: IAFile): string {
  const base = (f.title || f.name).replace(/\.mp3$/i, "").replace(/[_-]+/g, " ").trim();
  return base || "Track";
}

export const librivox: SourceAdapter = {
  id: "librivox",
  label: "LibriVox",
  type: "audiobook",
  siteUrl: "https://librivox.org",
  note: "Free public-domain audiobooks, narrated by volunteers — plays in-app",

  async search(q, page, limit, _nsfw, lang) {
    const words = q.trim().split(/\s+/).slice(0, 6).map((w) => w.replace(/[^\w']/g, "")).filter(Boolean);
    const titleQ = words.length ? `AND title:(${words.join(" AND ")})` : "";
    return iaSearch(
      `collection:${AUDIO_COLLECTION} ${titleQ}${iaLangClause(lang)}`,
      page,
      Math.min(limit, 30),
      "downloads desc",
    );
  },

  async popular(page, limit, _nsfw, lang) {
    return iaSearch(
      `collection:${AUDIO_COLLECTION}${iaLangClause(lang)}`,
      page,
      Math.min(limit, 30),
      "downloads desc",
    );
  },

  async details(realId) {
    const meta = await fetchJson<IAMeta>(`https://archive.org/metadata/${encodeURIComponent(realId)}`, {
      timeoutMs: 15_000,
      retries: 1,
    });
    const m = meta.metadata ?? {};

    // Archives carry the same track at several bitrates (64kb / 128kb / VBR) —
    // group by BASE NAME and keep ONE copy per track, preferring the standard
    // 64kb LibriVox encode (rank-sorted before dedup).
    const mp3s = (meta.files ?? [])
      .filter((f) => AUDIO_FORMAT.test(f.format ?? "") && /\.mp3$/i.test(f.name))
      .sort((a, b) => fmtRank(a.format) - fmtRank(b.format));
    const baseKey = (name: string) =>
      name.replace(/\.mp3$/i, "").replace(/[_-]*(?:64kb|128kb|vbr)[_-]*.*$/i, "") || name;
    const byTrack = new Map<string, IAFile>();
    for (const f of mp3s) {
      const key = baseKey(f.name);
      if (!byTrack.has(key)) byTrack.set(key, f);
    }

    const trackNo = (f: IAFile) => parseInt((f.track ?? "").split("/")[0] ?? "", 10) || 0;
    const audioFiles = [...byTrack.values()].sort(
      (a, b) => trackNo(a) - trackNo(b) || a.name.localeCompare(b.name, undefined, { numeric: true }),
    );

    const chapters: ChapterEntry[] = audioFiles.map((f) => ({
      id: `librivox-ch:${realId}:${f.name}`,
      label: prettyTrackName(f),
      seq: trackNo(f) || undefined,
      num: trackNo(f) || undefined,
      date: m.publicdate?.slice(0, 10),
      file: { ext: "mp3", size: humanSize(f.size) },
      pages: durMinutes(f.length), // minutes — shown as "N min" on audio rows
    }));

    if (audioFiles.length) {
      // whole-book ZIP — one tap to keep the audiobook offline
      chapters.push({
        id: `librivox-zip:${realId}`,
        label: "Complete audiobook — single ZIP",
        file: { ext: "zip" },
      });
    }

    const creator = first(m.creator);
    return {
      id: `librivox:${realId}`,
      type: "audiobook",
      source: "librivox",
      sourceLabel: "LibriVox",
      title: (first(m.title) ?? realId).replace(/, by .*/, ""),
      subtitle: creator,
      authors: creator ? [creator] : [],
      description: stripHtml(first(m.description), 1400),
      publishedAt: m.date?.slice(0, 10),
      cover: `https://archive.org/services/img/${realId}`,
      externalUrl: itemUrl(realId),
      status: m.runtime ? `Runtime ${m.runtime}` : `${audioFiles.length} tracks`,
      chapters,
      readable: true,
    } satisfies Details;
  },

  /** Returns the streamable mp3 URL for one track. */
  async chapterPages(realId) {
    const sep = realId.indexOf(":");
    const identifier = realId.slice(0, sep);
    const fileName = realId.slice(sep + 1);
    if (!identifier || !fileName) throw new Error("Bad track id");
    return { audio: `https://archive.org/download/${encodeURIComponent(identifier)}/${fileName.split("/").map(encodeURIComponent).join("/")}` };
  },
};
