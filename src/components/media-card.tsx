"use client";

import { memo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Download, Heart, Headphones } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { openTitle } from "@/lib/nav";
import { proxiedImg, useApp } from "@/store/app-store";
import type { MediaItem } from "@/lib/sources/types";

const FALLBACK_COLORS = [
  "from-violet-900/60 to-fuchsia-900/40",
  "from-purple-900/60 to-rose-900/40",
  "from-fuchsia-900/60 to-purple-900/40",
  "from-violet-800/60 to-rose-900/40",
];

export const MediaCard = memo(function MediaCard({ item }: { item: MediaItem }) {
  const router = useRouter();
  const toggleFavorite = useApp((s) => s.toggleFavorite);
  const isFavorite = useApp((s) => s.favorites.some((f) => f.id === item.id));
  const [imgOk, setImgOk] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const color = FALLBACK_COLORS[item.id.length % FALLBACK_COLORS.length];

  return (
    <div className="group relative">
      <button
        onClick={() => openTitle(router, item)}
        className="block w-full overflow-hidden rounded-xl border bg-card text-left outline-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
        aria-label={`${item.title} — open full page`}
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
          {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
          {imgOk && item.cover ? (
            <img
              src={proxiedImg(item.cover)}
              alt={`${item.title} cover`}
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setImgOk(false)}
              className={`size-full object-cover transition-all duration-300 group-hover:scale-[1.04] ${loaded ? "opacity-100" : "opacity-0"}`}
            />
          ) : (
            <div className={`flex size-full items-center justify-center bg-gradient-to-br p-3 text-center ${color}`}>
              <span className="line-clamp-4 text-xs font-medium text-white/85 sm:text-sm">{item.title}</span>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/25 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
          {item.description && (
            <p className="absolute inset-x-0 bottom-0 hidden max-h-[55%] overflow-hidden p-2.5 text-[11px] leading-snug text-white/90 opacity-0 transition-opacity duration-200 group-hover:line-clamp-5 group-hover:opacity-100 sm:block">
              {item.description}
            </p>
          )}

          <Badge className="pointer-events-none absolute top-1.5 left-1.5 bg-black/65 px-1.5 text-[9px] font-semibold tracking-wide text-white backdrop-blur sm:text-[10px]">
            {item.sourceLabel}
          </Badge>
          {item.nsfw && (
            <Badge className="pointer-events-none absolute top-1.5 left-1/2 -translate-x-1/2 bg-destructive px-1.5 text-[9px] font-bold tracking-wide text-white backdrop-blur sm:text-[10px]">
              18+
            </Badge>
          )}
          {item.year ? (
            <span className="pointer-events-none absolute top-1.5 right-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur sm:text-[10px]">
              {item.year}
            </span>
          ) : null}
          {/* read capability — some sources stream chapters, others only serve files */}
          {item.readable !== undefined && (
            <span
              className={`pointer-events-none absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur sm:text-[10px] ${
                item.readable ? "bg-emerald-600/85" : "bg-amber-600/85"
              }`}
              title={
                item.type === "audiobook"
                  ? "Plays in the built-in player"
                  : item.readable
                    ? "Readable in the built-in reader"
                    : "Download only — no in-browser reader"
              }
            >
              {item.type === "audiobook" ? (
                <Headphones className="size-2.5" aria-hidden />
              ) : item.readable ? (
                <BookOpen className="size-2.5" aria-hidden />
              ) : (
                <Download className="size-2.5" aria-hidden />
              )}
              {item.type === "audiobook" ? "Listen" : item.readable ? "Read" : "File"}
            </span>
          )}
        </div>

        <div className="p-2 sm:p-2.5">
          <h3 className="line-clamp-1 text-xs font-semibold sm:text-sm" title={item.title}>
            {item.title}
          </h3>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground sm:text-xs">
            {item.authors?.length
              ? item.authors.join(", ")
              : item.subtitle || item.tags?.[0] || "—"}
          </p>
          {(item.status || item.latest) && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/80 sm:text-[11px]">
              {item.status && <span className="line-clamp-1">{item.status}</span>}
              {item.status && item.latest && <span aria-hidden>·</span>}
              {item.latest && <span className="text-primary/80">{item.latest}</span>}
            </p>
          )}
        </div>
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(item);
        }}
        aria-label={isFavorite ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`}
        className={`absolute right-1.5 bottom-1.5 z-10 grid size-7 place-items-center rounded-full backdrop-blur transition-all sm:opacity-0 sm:group-hover:opacity-100 ${
          isFavorite ? "bg-primary text-primary-foreground opacity-100" : "bg-black/55 text-white hover:bg-black/75"
        }`}
      >
        <Heart className={`size-3.5 ${isFavorite ? "fill-current" : ""}`} aria-hidden />
      </button>
    </div>
  );
});

export function MediaCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[2/3] w-full rounded-xl" />
      <Skeleton className="mt-2 h-3.5 w-3/4 rounded-md" />
      <Skeleton className="mt-1.5 h-3 w-1/2 rounded-md" />
    </div>
  );
}
