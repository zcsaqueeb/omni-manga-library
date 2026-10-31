"use client";

import { Download, Heart, Moon, ShieldAlert, Sun, Layers } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { UserButton } from "@/components/user-button";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useApp } from "@/store/app-store";

const emptySubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

export function AppHeader({ search }: { search: React.RefObject<HTMLInputElement | null> }) {
  const {
    query,
    setQuery,
    setLibraryOpen,
    setDownloadsOpen,
    setSourcesOpen,
    favorites,
    downloads,
    adult,
    setAdult,
  } = useApp();
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const [confirmAdult, setConfirmAdult] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-4">
        <button
          className="flex shrink-0 items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
          onClick={() => {
            setQuery("");
            search.current?.focus();
          }}
          aria-label="OmniLibrary home"
        >
          <span className="grid size-8 place-items-center rounded-lg shadow-sm sm:size-9">
            <BrandLogo className="size-8 rounded-lg sm:size-9" aria-hidden />
          </span>
          <span className="hidden text-base font-bold tracking-tight sm:block">
            Omni<span className="text-primary">Library</span>
          </span>
        </button>

        <div className="relative flex-1 sm:max-w-xl">
          <Input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search manga, comics, books, novels, audiobooks…"
            aria-label="Search library"
            className="h-10 rounded-full bg-muted/60 pr-9 pl-9 text-sm sm:h-11"
            enterKeyHint="search"
          />
          <svg
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {/* 18+ master switch */}
          <Button
            variant="ghost"
            size="icon"
            className={`relative size-10 ${adult ? "text-destructive" : ""}`}
            onClick={() => (adult ? setAdult(false) : setConfirmAdult(true))}
            aria-label={adult ? "Turn off 18+ content" : "Turn on 18+ content"}
            aria-pressed={adult}
            title={adult ? "18+ ON — showing ONLY adult & hentai content" : "18+ OFF — adult content hidden"}
          >
            <ShieldAlert className="size-5" aria-hidden />
            {adult && (
              <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[8px] font-bold text-white">
                ON
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="relative size-10"
            onClick={() => setSourcesOpen(true)}
            aria-label="Sources settings"
            title="Sources — enable/disable, health, 18+ flags"
          >
            <Layers className="size-5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="relative size-10"
            onClick={() => setLibraryOpen(true)}
            aria-label={`Library (${favorites.length} favorites)`}
          >
            <Heart className="size-5" aria-hidden />
            {mounted && favorites.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                {favorites.length > 99 ? "99" : favorites.length}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="relative size-10"
            onClick={() => setDownloadsOpen(true)}
            aria-label={`Downloads (${downloads.length})`}
          >
            <Download className="size-5" aria-hidden />
            {mounted && downloads.some((d) => d.status === "downloading") && (
              <span className="absolute top-1.5 right-1.5 size-2 animate-pulse rounded-full bg-primary" aria-hidden />
            )}
          </Button>
          {/* account — private library, favorites & history per user */}
          <UserButton />
          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {mounted && theme === "dark" ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmAdult} onOpenChange={setConfirmAdult}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable 18+ only mode?</AlertDialogTitle>
            <AlertDialogDescription>
              While this switch is ON, OmniLibrary shows ONLY adult content — 18+ sources
              (Toonily, MangaSusu, KunManga, MangaTx, ZinManga, ManhwaClan, Ruya Manga…) and
              18+-rated titles like hentai and adult manhwa. Everything else stays hidden until
              you turn the switch back off.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep hidden</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => setAdult(true)}
            >
              Show only 18+ content
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
