"use client";

import type { MediaItem } from "@/lib/sources/types";

/**
 * Navigation helpers for full-page title views.
 *
 * Before pushing the route we snapshot the clicked item into sessionStorage —
 * the /title page paints cover + title from that snapshot instantly, then
 * upgrades to the full details payload when /api/details answers.
 */

const PRE = "ol:pre:";

export function titleHref(id: string): string {
  return `/title/${encodeURIComponent(id)}`;
}

/** Stash the card the user clicked and navigate to its full page. */
export function openTitle(router: { push: (href: string) => void }, item: MediaItem): void {
  try {
    sessionStorage.setItem(PRE + item.id, JSON.stringify(item));
  } catch {
    /* private mode — the page will simply use skeletons instead */
  }
  router.push(titleHref(item.id));
}

/** Instant-paint snapshot for a title page (null when opened directly by URL). */
export function readPreDetail(id: string): MediaItem | null {
  try {
    const raw = sessionStorage.getItem(PRE + id);
    return raw ? (JSON.parse(raw) as MediaItem) : null;
  } catch {
    return null;
  }
}
