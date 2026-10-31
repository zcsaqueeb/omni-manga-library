/** Shared contracts between source adapters, API routes and the UI. */

export type Category = "manga" | "comic" | "book" | "novel" | "audiobook" | "official";

export interface ChapterFile {
  ext: string;
  size?: string;
}

/** Minimal archive.org metadata file entry — shared by the audiobook sources. */
export interface IAFileLike {
  name: string;
  title?: string;
  track?: string;
  format?: string;
  length?: string;
  size?: string;
}

export interface ChapterEntry {
  /** Globally unique id — `<source>-ch:<realId>` for readable chapters, `<source>-file:<…>` for files. */
  id: string;
  label: string;
  lang?: string;
  pages?: number;
  group?: string;
  /** Release/publish date (YYYY-MM-DD when the source provides one). */
  date?: string;
  /** Parsed chapter number (e.g. 12.5) — stamped by the details normalizer
   * when the label carries one; powers the clean "#N" chips. */
  num?: number;
  /** Adapter-guaranteed sequence (audiobook track numbers). When present the
   * normalizer trusts this over label parsing — track titles like
   * "Adhyaay 04 to 09" must never be read as "chapter 9". */
  seq?: number;
  /** Parsed volume number when the label carries one. */
  volume?: number;
  /** Direct file download metadata (books/comics). */
  file?: ChapterFile;
  /** When set, the entry is an external link (open in a new tab) instead of readable/downloadable. */
  href?: string;
}

export interface MediaItem {
  id: string; // `<source>:<realId>`
  type: Category;
  source: string;
  sourceLabel: string;
  title: string;
  subtitle?: string;
  cover?: string;
  year?: number;
  /** Author names when known from search/browse payloads. */
  authors?: string[];
  status?: string;
  tags?: string[];
  description?: string;
  externalUrl?: string;
  /** 18+ item — only shown when the adult switch is on. */
  nsfw?: boolean;
  /** Latest chapter label, e.g. "Ch. 123". */
  latest?: string;
  /** true → the source supports in-browser reading (chapters);
   * false → this source only offers file downloads. Stamped server-side. */
  readable?: boolean;
}

export interface Details extends MediaItem {
  authors: string[];
  status?: string;
  publishedAt?: string;
  chapters: ChapterEntry[];
  /** true → chapters are readable in the built-in reader. */
  readable: boolean;
}

export interface SearchResult {
  items: MediaItem[];
  total: number;
  page: number;
  hasMore: boolean;
}

/** Chapter payload — page image URLs, plain text (novels), an inline PDF URL (books)
 * or a single audio stream URL (audiobooks). */
export type ChapterPayload = string[] | { text: string } | { pdf: string } | { audio: string };

export interface SourceAdapter {
  id: string;
  label: string;
  type: Category;
  siteUrl: string;
  /** Source aggregates 18+ titles — hidden entirely unless the adult switch is on. */
  nsfw?: boolean;
  /** Template-based adapter whose target site may change domains — shown with a beta badge. */
  beta?: boolean;
  note?: string;
  /** Mirror base URLs tried when the primary fails (domain rotation). */
  mirrors?: string[];
  /** Extra image hosts the /api/img proxy will allow for this source. */
  imgHosts?: string[];
  /** Source mixes safe & adult titles with per-item ratings (MangaDex) —
   * stays useful in 18+-only mode where items are filtered to nsfw only. */
  perItemRatings?: boolean;
  /** nsfw=true → include 18+ content where the source supports per-item ratings (MangaDex).
   * lang → ISO 639-1 code ("hi", "ur", "en"…) — sources that can't filter by
   * language simply ignore it (optional param). */
  search(q: string, page: number, limit: number, nsfw?: boolean, lang?: string): Promise<SearchResult>;
  popular?(page: number, limit: number, nsfw?: boolean, lang?: string): Promise<SearchResult>;
  details(realId: string): Promise<Details>;
  /** Resolve a readable chapter into page image URLs or a text payload. */
  chapterPages?(realId: string): Promise<ChapterPayload>;
  /** Resolve a file entry id into a direct download URL. */
  resolveFile?(realId: string): Promise<{ url: string; name?: string }>;
}

/** The full 105-source catalogue (see catalog.ts) — powers the Sources sheet and the Official tab. */
export interface CatalogEntry {
  id: string;
  name: string;
  category: Category;
  url: string;
  nsfw?: boolean;
  /** Adapter id when a live-search adapter exists for this source. */
  adapterId?: string;
  /** Official/storefront platform — external link only, never scraped. */
  official?: boolean;
  /** Template-based adapter whose target site may change domains. */
  beta?: boolean;
  note?: string;
}
