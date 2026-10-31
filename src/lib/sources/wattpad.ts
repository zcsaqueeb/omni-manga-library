import { fetchJson, stripHtml, upstreamFetch } from "@/lib/http";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

/**
 * Wattpad — the world's largest web-fiction community (90M+ users).
 * Clean public JSON API: /api/v3/stories for search, story detail includes
 * every part, and /apiv2/storytext returns the full chapter HTML.
 */

const API = "https://www.wattpad.com/api/v3";

interface WPUser {
  name?: string;
  fullname?: string;
}

interface WPStory {
  id: string | number;
  title?: string;
  description?: string;
  cover?: string;
  user?: WPUser;
  createDate?: string;
  modifyDate?: string;
  voteCount?: number;
  readCount?: number;
  completed?: boolean;
  mature?: boolean;
  tags?: string[];
  numParts?: number;
  url?: string;
  parts?: WPPart[];
}

interface WPPart {
  id: string | number;
  title?: string;
  url?: string;
  draft?: boolean;
  createDate?: string;
}

function toItem(s: WPStory): MediaItem {
  return {
    id: `wattpad:${s.id}`,
    type: "novel",
    source: "wattpad",
    sourceLabel: "Wattpad",
    title: s.title?.trim() || `Story #${s.id}`,
    subtitle: s.user?.fullname || s.user?.name,
    cover: s.cover,
    authors: [s.user?.fullname || s.user?.name].filter(Boolean) as string[],
    tags: s.tags?.slice(0, 4),
    description: stripHtml(s.description, 500),
    status: s.completed ? "Completed" : s.numParts ? `${s.numParts} parts` : undefined,
    externalUrl: s.url ?? `https://www.wattpad.com/story/${s.id}`,
    nsfw: s.mature ? true : undefined,
  };
}

export const wattpad: SourceAdapter = {
  id: "wattpad",
  label: "Wattpad",
  type: "novel",
  siteUrl: "https://www.wattpad.com",
  note: "The largest web-fiction community — every story reads in-app",

  async search(q, page, limit) {
    const data = await fetchJson<{ stories?: WPStory[]; total?: number }>(
      `${API}/stories?query=${encodeURIComponent(q.slice(0, 80))}&limit=${Math.min(limit, 25)}&offset=${(page - 1) * limit}`,
      { timeoutMs: 12_000, retries: 1 },
    );
    const items = (data.stories ?? []).map(toItem);
    return { items, total: items.length, page, hasMore: items.length >= Math.min(limit, 25) };
  },

  async popular(page, limit) {
    // The public API has no global ranking endpoint — rotate proven
    // evergreen queries so the shelf always has real, popular stories.
    const seeds = [
      "romance",
      "werewolf",
      "mafia",
      "fantasy",
      "bad boy",
      "vampire",
    ];
    const seed = seeds[(page - 1) % seeds.length];
    const data = await fetchJson<{ stories?: WPStory[] }>(
      `${API}/stories?query=${encodeURIComponent(seed)}&limit=${Math.min(limit, 25)}`,
      { timeoutMs: 12_000, retries: 1 },
    );
    const items = (data.stories ?? []).map(toItem);
    return { items, total: items.length, page, hasMore: page < seeds.length };
  },

  async details(realId) {
    const s = await fetchJson<WPStory>(`${API}/stories/${encodeURIComponent(realId)}`, {
      timeoutMs: 12_000,
      retries: 1,
    });

    const chapters: ChapterEntry[] = (s.parts ?? [])
      .filter((p) => !p.draft)
      .map((p) => ({
        id: `wattpad-ch:${p.id}`,
        label: p.title?.trim() || `Part ${p.id}`,
        date: p.createDate?.slice(0, 10),
      }));

    const item = toItem(s);
    return {
      ...item,
      authors: item.authors ?? [],
      status: s.completed ? "Completed" : "Ongoing",
      publishedAt: s.createDate?.slice(0, 10),
      description: stripHtml(s.description, 1400) ?? item.description,
      chapters,
      readable: true,
    } satisfies Details;
  },

  async chapterPages(realId) {
    // /apiv2/storytext answers with raw HTML paragraphs
    const html = await upstreamFetch(
      `https://www.wattpad.com/apiv2/storytext?id=${encodeURIComponent(realId)}`,
      { timeoutMs: 15_000, retries: 1, headers: { Accept: "text/html,*/*" } },
    ).then(async (res) => {
      if (!res.ok) throw new Error(`Upstream ${res.status} for storytext`);
      return res.text();
    });

    // storytext returns <p data-p-id="…">paragraph</p> chunks
    const paras = html
      .split(/<\/p>/i)
      .map((p) => stripHtml(p, 20_000)?.trim())
      .filter((p): p is string => !!p && p.length > 0);
    const text = paras.join("\n\n").trim();
    if (!text) throw new Error("Empty chapter text");
    return { text };
  },
};
