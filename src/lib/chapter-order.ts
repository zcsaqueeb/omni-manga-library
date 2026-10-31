/**
 * Chapter ordering — the "perfect in-order chapter list" layer.
 *
 * Every source adapter returns chapters in whatever order its site lists
 * them (usually release-date order, sometimes arbitrary). Release order is
 * NOT chapter-number order: specials, season resets, batch uploads and
 * volume tags all scramble it — that is why chapter lists could look
 * random. This module parses the REAL chapter number out of labels
 * ("Vol.2 Ch.45", "Chapter 12.5", "第45话", "Capítulo 34", "#12", "v01c005",
 * bare "12"…) and normalizes details payloads into a deduped, strictly
 * ascending list. It is applied centrally in /api/details, so the work
 * happens once per title and every user shares the same clean list.
 */

import type { ChapterEntry } from "./sources/types";

export interface ChapterKey {
  volume: number | null;
  number: number | null;
  /** "Chapter 5 Part 2" → 2 — orders part-chapters of the same number. */
  part: number | null;
}

/** Share of entries that must carry a parseable number before we trust
 * numeric sorting — protects file lists (EPUB/PDF) and titled-only chapter
 * lists (fanfiction.net) from being scrambled by stray numbers. */
const TRUST_RATIO = 0.6;

const HTML_ENTITIES = /&[a-z#0-9]+;/gi;

/** Bonus/extra words — they never imply a chapter number by themselves. */
const BONUS_WORD =
  /(?:extra|extras|omake|special|oneshot|one-shot|one\s?shot|prologue|interlude|side\s?story|side\s?chapter|bonus|afterword|foreword|anthology|artbook|drama\s?cd|notice|announcement|fanbook|illustration|preview|teaser)/i;

/** Labels like "Chapter 5 Part 2" describe the same number twice — they must
 * survive the per-number dedupe. Word-bounded so chapter titles like
 * "The Tea Party" never match. */
const PART_WORD = /(?:\bpart\b\s*\d*|\bp\.?\s*\d+\b|\bsplit\b)/i;

const VOL_PATTERNS: RegExp[] = [
  /(?:^|[^\p{L}\d])(?:vol(?:ume)?|tome|tom[eu]|band|libro|livre)[.\s]*(\d{1,3}(?:[.,]\d+)?)/iu, // Vol.2 / Volume 2 / Tome 3
  /(?:^|[^\p{L}\d])v(?:ol)?[.\s]*(\d{1,3}(?:[.,]\d+)?)(?=[^\d.,]|$)/iu, // v01 / v2
  /第\s*(\d{1,3}(?:[.,]\d+)?)\s*[卷季]/u, // 第2卷
];

/** Explicit chapter-number patterns, most trustworthy first. */
const NUM_PATTERNS: RegExp[] = [
  /第\s*(\d{1,4}(?:[.,]\d+)?)\s*[话話章回节節]/u, // 第45话 / 第12章
  /(?:^|[^\p{L}\d])(?:chapter|chap|chpt|ch|episode|ep|cap[uiú]tulo|cap)[.\s]*(?:#|№|n[°o])?\s*(\d{1,4}(?:[.,]\d+)?)/iu, // Chapter 12 / Ch.12 / Ep 5 / Cap. 3
  /(?:^|\s)[#№]\s*(\d{1,4}(?:[.,]\d+)?)/u, // #45
  /(?:^|[^\p{L}\d])c(?:h)?[._\-](\d{1,4}(?:[.,]\d+)?)(?=[^\d.,]|$)/iu, // v01c005 / ch_12
  /^(\d{1,4}(?:[.,]\d+)?)$/u, // bare "12" / "12.5"
];

const toNum = (s: string): number => parseFloat(s.replace(",", "."));

function cleanLabel(label: string): string {
  return String(label ?? "")
    .replace(HTML_ENTITIES, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u00a0\u200b]/g, " ")
    .trim();
}

/** Parse (volume, chapter number, part) out of a raw chapter label. Never throws. */
export function parseChapterKey(rawLabel: string): ChapterKey {
  const label = cleanLabel(rawLabel);
  if (!label) return { volume: null, number: null, part: null };

  let volume: number | null = null;
  let working = label;
  // A trailing "v2" right after a chapter number means "version 2" (a
  // re-upload), not volume 2 — only trust the bare-v form when the label has
  // no explicit chapter keyword (e.g. "v01c005").
  const hasChapterKeyword = /\b(?:ch(?:apter)?|ep(?:isode)?|cap|第)[.\s]*\d/i.test(label);
  const volPatterns = hasChapterKeyword ? VOL_PATTERNS.filter((_, i) => i !== 1) : VOL_PATTERNS;
  for (const re of volPatterns) {
    const m = working.match(re);
    if (m) {
      volume = toNum(m[1]);
      working = working.replace(m[0], " ");
      break;
    }
  }

  let number: number | null = null;
  for (const re of NUM_PATTERNS) {
    const m = working.match(re);
    if (m) {
      number = toNum(m[1]);
      break;
    }
  }

  // Last resort: a TRAILING standalone number that is not a year and not
  // part of a date — "One Piece 1044", "Fairy Tail: 100 Years Quest 12".
  // (Mid-label numbers like "5 cm poster" are not chapter numbers.)
  if (number === null && !BONUS_WORD.test(working)) {
    const withoutDates = working
      .replace(/\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/g, " ")
      .replace(/\(\s*\d{4}\s*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const trailing = withoutDates.match(/(\d{1,4}(?:[.,]\d+)?)\s*$/);
    if (trailing && !/^(?:1[89]\d{2}|20\d{2})$/.test(trailing[1].replace(",", "."))) {
      number = toNum(trailing[1]);
    }
  }

  // "Chapter 5 Part 2" / "Ch. 5 p.2" — orders split chapters of one number.
  const partMatch = label.match(/\b(?:part|pt|p)\.?\s*(\d{1,2})\b/i);
  const part = partMatch ? parseInt(partMatch[1], 10) : null;

  return {
    volume: Number.isFinite(volume as number) ? (volume as number) : null,
    number: Number.isFinite(number as number) ? (number as number) : null,
    part: Number.isFinite(part as number) ? (part as number) : null,
  };
}

/** "12" → "12", "12.5" → "12.5", "12.0" → "12" — for chips and latest badges. */
export function formatChapterNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

/** Dedupe priority for the same chapter number: a chapter that opens in the
 * in-app reader always beats an external publisher link (every row stays
 * readable), then English beats other languages. */
function beatsChapter(incoming: ChapterEntry, current: ChapterEntry): boolean {
  const iHref = !!incoming.href;
  const cHref = !!current.href;
  if (iHref !== cHref) return !iHref; // internal beats external
  const iEn = (incoming.lang ?? "").toLowerCase() === "en";
  const cEn = (current.lang ?? "").toLowerCase() === "en";
  return !cEn && iEn;
}

export interface NormalizeResult<T> {
  chapters: T[];
  /** true when the list was re-sorted by parsed chapter number */
  sortedByNumber: boolean;
  /** highest chapter number in the list (for the "Ch. N" latest badge) */
  maxNumber: number | null;
}

/**
 * Normalize a details chapter list:
 *  1. drop exact-duplicate ids,
 *  2. when the source is readable and most labels carry numbers — keep ONE
 *     entry per chapter number (English preferred, part-chapters kept) and
 *     sort strictly ascending by number (oldest → newest),
 *  3. stamp `num`/`volume` on entries so the UI can show clean "#45" chips.
 *
 * File lists and titled-only chapter lists pass through in source order
 * (id-deduped only) so nothing that was already intentional gets scrambled.
 */
export function normalizeChapters<T extends ChapterEntry>(input: T[], readable: boolean): NormalizeResult<T> {
  const byId = new Set<string>();
  const list: T[] = [];
  for (const ch of input) {
    if (byId.has(ch.id)) continue;
    byId.add(ch.id);
    list.push(ch);
  }

  /* ── adapter-guaranteed sequence (audiobook tracks) ─────────────────────
   * Audio adapters stamp `seq` with the real track number. Labels are often
   * titles ("Adhyaay 04 to 09") whose trailing numbers are NOT chapter
   * numbers — so when most entries carry a seq, group by seq directly:
   * no label parsing, no lossy dedupe, strict track order. */
  const withSeq = list.filter((ch) => typeof ch.seq === "number");
  if (readable && withSeq.length >= Math.max(3, list.length * TRUST_RATIO)) {
    const seen = new Set<number>();
    const numbered: T[] = [];
    const unnumbered: T[] = [];
    for (const ch of list) {
      if (typeof ch.seq === "number") {
        if (seen.has(ch.seq)) continue;
        seen.add(ch.seq);
        numbered.push(ch.num === ch.seq ? ch : { ...ch, num: ch.seq });
      } else {
        unnumbered.push(ch);
      }
    }
    numbered.sort((a, b) => a.seq! - b.seq!);
    const out = [...numbered, ...unnumbered];
    const maxSeq = numbered.length ? numbered[numbered.length - 1].seq! : null;
    return { chapters: out, sortedByNumber: true, maxNumber: maxSeq };
  }

  const withKeys = list.map((ch, i) => ({ ch, i, key: parseChapterKey(ch.label) }));
  const numbered = withKeys.filter((e) => e.key.number !== null);

  if (!readable || numbered.length < Math.max(3, withKeys.length * TRUST_RATIO)) {
    return { chapters: list, sortedByNumber: false, maxNumber: null };
  }

  // One entry per chapter number — readable (in-app) versions always beat
  // external publisher links, English beats other languages, then first
  // listed. "Part" chapters (Ch.5 Part 1/2) and unnumbered specials are
  // always kept.
  const winners = new Map<number, (typeof withKeys)[number]>();
  const keptUnnumbered: typeof withKeys = [];
  for (const e of withKeys) {
    if (e.key.number === null || PART_WORD.test(cleanLabel(e.ch.label))) {
      keptUnnumbered.push(e);
      continue;
    }
    const prev = winners.get(e.key.number);
    if (!prev) {
      winners.set(e.key.number, e);
      continue;
    }
    if (beatsChapter(e.ch, prev.ch)) winners.set(e.key.number, e);
  }

  const ordered = [...winners.values()].sort(
    (a, b) =>
      a.key.number! - b.key.number! ||
      (a.key.volume ?? 0) - (b.key.volume ?? 0) ||
      a.i - b.i,
  );

  const out: T[] = [];
  for (const e of [
    ...ordered,
    ...keptUnnumbered.sort(
      // part-chapters (Ch.5 Part 1 → Part 2) and specials keep a sensible
      // order among themselves; sites often list them newest-first
      (a, b) =>
        (a.key.number ?? Number.MAX_SAFE_INTEGER) - (b.key.number ?? Number.MAX_SAFE_INTEGER) ||
        (a.key.part ?? 0) - (b.key.part ?? 0) ||
        a.i - b.i,
    ),
  ]) {
    const ch = e.ch;
    const stamped: T =
      ch.num !== e.key.number || ch.volume !== e.key.volume
        ? { ...ch, num: e.key.number ?? undefined, volume: e.key.volume ?? undefined }
        : ch;
    out.push(stamped);
  }

  const maxNumber = ordered.length ? ordered[ordered.length - 1].key.number : null;
  return { chapters: out, sortedByNumber: true, maxNumber };
}
