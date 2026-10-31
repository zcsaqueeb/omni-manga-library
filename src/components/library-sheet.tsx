"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, History, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { openTitle } from "@/lib/nav";
import { proxiedImg, useApp } from "@/store/app-store";
import type { MediaItem } from "@/lib/sources/types";

function MiniCard({ item, onRemove }: { item: MediaItem; onRemove?: () => void }) {
  const router = useRouter();
  const setLibraryOpen = useApp((s) => s.setLibraryOpen);
  const [imgOk, setImgOk] = useState(true);

  return (
    <div className="group relative">
      <button
        onClick={() => {
          setLibraryOpen(false);
          openTitle(router, item);
        }}
        className="block w-full overflow-hidden rounded-lg border bg-card text-left outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${item.title} — open full page`}
      >
        <div className="aspect-[2/3] w-full bg-muted">
          {imgOk && item.cover ? (
            <img
              src={proxiedImg(item.cover)}
              alt={`${item.title} cover`}
              loading="lazy"
              className="size-full object-cover"
              onError={() => setImgOk(false)}
            />
          ) : (
            <div className="grid size-full place-items-center bg-gradient-to-br from-violet-900/60 to-fuchsia-900/40 p-1 text-center">
              <span className="line-clamp-3 text-[10px] font-medium text-white/85">{item.title}</span>
            </div>
          )}
        </div>
        <p className="line-clamp-1 px-1.5 py-1 text-[10px] font-medium sm:text-[11px]">{item.title}</p>
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${item.title}`}
          className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function LibrarySheet() {
  const { libraryOpen, setLibraryOpen, favorites, history, toggleFavorite, clearHistory, user } =
    useApp();
  const [tab, setTab] = useState<"favorites" | "history">("favorites");

  const items = tab === "favorites" ? favorites : history;

  return (
    <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b px-4 py-3.5">
          <SheetTitle className="flex items-center gap-2 text-base">
            Your library
            {user && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                <UserRound className="size-3" aria-hidden />
                {user.username}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {user
              ? "Private to your account — nobody else can see it, on any device."
              : "Saved on this device only — sign in to keep your own private library everywhere."}
          </SheetDescription>
        </SheetHeader>

        <div className="border-b px-4 py-2.5">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "favorites" | "history")}>
            <TabsList className="h-9 w-full">
              <TabsTrigger value="favorites" className="flex-1 gap-1.5 text-xs">
                <Heart className="size-3.5" aria-hidden />
                Favorites ({favorites.length})
              </TabsTrigger>
              <TabsTrigger value="history" className="flex-1 gap-1.5 text-xs">
                <History className="size-3.5" aria-hidden />
                History ({history.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            {tab === "favorites" ? (
              <Heart className="size-10 text-muted-foreground/40" aria-hidden />
            ) : (
              <History className="size-10 text-muted-foreground/40" aria-hidden />
            )}
            <p className="text-sm font-medium">{tab === "favorites" ? "No favorites yet" : "Nothing viewed yet"}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {tab === "favorites"
                ? "Tap the heart on any cover to keep it here for quick access."
                : "Titles you open will appear here automatically."}
            </p>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1">
              <div className="grid grid-cols-3 gap-2.5 px-4 py-4">
                {items.map((item) => (
                  <MiniCard
                    key={item.id}
                    item={item}
                    onRemove={
                      tab === "favorites"
                        ? () => toggleFavorite(item)
                        : undefined
                    }
                  />
                ))}
              </div>
            </ScrollArea>
            {tab === "history" && (
              <div className="border-t p-3">
                <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={clearHistory}>
                  <Trash2 className="size-3.5" aria-hidden />
                  Clear history
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
