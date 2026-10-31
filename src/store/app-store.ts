"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Category, ChapterEntry, MediaItem } from "@/lib/sources/types";

export interface AuthUser {
  id: string;
  username: string;
}

export interface DownloadEntry {
  id: string;
  title: string;
  kind: "chapter" | "file";
  startedAt: number;
  status: "downloading" | "done" | "error";
  message?: string;
}

export interface ReaderState {
  chapterId: string;
  chapterLabel: string;
  itemTitle: string;
  /** Full chapter list + current position → powers next/prev chapter. */
  chapters?: ChapterEntry[];
  chapterIndex?: number;
  /** Parent item for downloads from the reader. */
  item?: MediaItem | null;
}

interface AppState {
  /** Merge device-local favorites/history into the freshly signed-in account. */
  syncLocalIntoAccount: () => Promise<void>;
  tab: Category;
  query: string;
  sourceFilter: string; // "all" or source id
  /** Language filter — ISO 639-1 code or "all". Applied where sources support it
   * (Audiobooks: LibriVox + IA Audio Books; Books: Gutenberg/Open Library/IA). */
  lang: string;
  selected: MediaItem | null;
  reader: ReaderState | null;
  libraryOpen: boolean;
  downloadsOpen: boolean;
  sourcesOpen: boolean;

  /** 18+ switch — off by default; nsfw sources & titles are hidden entirely. */
  adult: boolean;
  /** Source ids the user disabled in the Sources sheet. */
  disabledSources: string[];

  favorites: MediaItem[];
  history: MediaItem[];
  downloads: DownloadEntry[];

  /** Signed-in account — null means browsing as a guest on this device. */
  user: AuthUser | null;
  /** True once the initial /api/auth/me check has completed. */
  authReady: boolean;

  bootstrapAuth: () => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;

  setTab: (t: Category) => void;
  setQuery: (q: string) => void;
  setSourceFilter: (s: string) => void;
  setLang: (l: string) => void;
  select: (item: MediaItem | null) => void;
  openReader: (r: ReaderState) => void;
  openReaderAt: (chapters: ChapterEntry[], index: number, itemTitle: string, item?: MediaItem | null) => void;
  closeReader: () => void;
  setLibraryOpen: (v: boolean) => void;
  setDownloadsOpen: (v: boolean) => void;
  setSourcesOpen: (v: boolean) => void;
  setAdult: (v: boolean) => void;
  toggleSource: (id: string) => void;

  toggleFavorite: (item: MediaItem) => void;
  isFavorite: (id: string) => boolean;
  pushHistory: (item: MediaItem) => void;
  addDownload: (entry: DownloadEntry) => void;
  updateDownload: (id: string, patch: Partial<DownloadEntry>) => void;
  clearDownloads: () => void;
  clearHistory: () => void;
}

const MAX_HISTORY = 48;

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      tab: "manga",
      query: "",
      sourceFilter: "all",
      lang: "all",
      selected: null,
      reader: null,
      libraryOpen: false,
      downloadsOpen: false,
      sourcesOpen: false,

      adult: false,
      disabledSources: [],

      favorites: [],
      history: [],
      downloads: [],

      user: null,
      authReady: false,

      bootstrapAuth: async () => {
        try {
          const res = await fetch("/api/auth/me", { cache: "no-store" });
          const data = await res.json();
          if (data.user) {
            set({ user: data.user });
            // Adopt the account's private library — the server copy wins.
            const lib = await fetch("/api/library", { cache: "no-store" });
            if (lib.ok) {
              const saved = await lib.json();
              set({ favorites: saved.favorites ?? [], history: saved.history ?? [] });
            }
          }
        } catch {
          /* offline / server hiccup — stay in guest mode with local data */
        } finally {
          set({ authReady: true });
        }
      },

      signUp: async (username, password) => {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not create the account.");
        set({ user: data.user });
        await get().syncLocalIntoAccount();
      },

      signIn: async (username, password) => {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not sign in.");
        set({ user: data.user });
        await get().syncLocalIntoAccount();
      },

      signOut: async () => {
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch {
          /* ignore network errors on sign-out */
        }
        set({ user: null });
      },

      setTab: (tab) => set({ tab, selected: null }),
      setQuery: (query) => set({ query }),
      setSourceFilter: (sourceFilter) => set({ sourceFilter }),
      setLang: (lang) => set({ lang }),
      select: (selected) => set({ selected }),
      openReader: (reader) =>
        set({
          reader: {
            ...reader,
            chapterIndex: reader.chapterIndex ?? reader.chapters?.findIndex((c) => c.id === reader.chapterId) ?? -1,
          },
        }),
      openReaderAt: (chapters, chapterIndex, itemTitle, item) =>
        set({
          selected: null,
          reader: {
            chapterId: chapters[chapterIndex].id,
            chapterLabel: chapters[chapterIndex].label,
            itemTitle,
            chapters,
            chapterIndex,
            item,
          },
        }),
      closeReader: () => set({ reader: null }),
      setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
      setDownloadsOpen: (downloadsOpen) => set({ downloadsOpen }),
      setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),
      setAdult: (adult) => set({ adult }),
      toggleSource: (id) => {
        const cur = get().disabledSources;
        set({
          disabledSources: cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id],
        });
      },

      toggleFavorite: (item) => {
        const exists = get().favorites.some((f) => f.id === item.id);
        set({
          favorites: exists
            ? get().favorites.filter((f) => f.id !== item.id)
            : [item, ...get().favorites].slice(0, 200),
        });
        // Keep the private account copy in sync (fire-and-forget).
        if (get().user) {
          void fetch("/api/library/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item, action: exists ? "remove" : "add" }),
          }).catch(() => {});
        }
      },
      isFavorite: (id) => get().favorites.some((f) => f.id === id),
      pushHistory: (item) => {
        const rest = get().history.filter((h) => h.id !== item.id);
        set({ history: [item, ...rest].slice(0, MAX_HISTORY) });
        if (get().user) {
          void fetch("/api/library/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item }),
          }).catch(() => {});
        }
      },
      addDownload: (entry) => set({ downloads: [entry, ...get().downloads].slice(0, 100) }),
      updateDownload: (id, patch) =>
        set({
          downloads: get().downloads.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        }),
      clearDownloads: () => set({ downloads: [] }),
      clearHistory: () => {
        set({ history: [] });
        if (get().user) {
          void fetch("/api/library/history", { method: "DELETE" }).catch(() => {});
        }
      },

      /** Push this device's local favorites/history into the account once,
       * then adopt the merged private state returned by the server. */
      syncLocalIntoAccount: async () => {
        const { favorites, history } = get();
        try {
          const res = await fetch("/api/library", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ favorites, history }),
          });
          if (res.ok) {
            const saved = await res.json();
            set({ favorites: saved.favorites ?? [], history: saved.history ?? [] });
          }
        } catch {
          /* keep local state if the sync failed */
        }
      },
    }),
    {
      name: "omnilibrary-store",
      partialize: (s) => ({
        favorites: s.favorites,
        history: s.history,
        downloads: s.downloads,
        tab: s.tab,
        lang: s.lang,
        adult: s.adult,
        disabledSources: s.disabledSources,
      }),
    },
  ),
);

/** Kick off the session check once on load (idempotent). */
let bootstrapped = false;
export function bootstrapAuthOnce() {
  if (bootstrapped) return;
  bootstrapped = true;
  void useApp.getState().bootstrapAuth();
}

/** Proxy helper — route remote covers through the caching image API. */
export const proxiedImg = (url?: string) =>
  url ? `/api/img?url=${encodeURIComponent(url)}` : undefined;
