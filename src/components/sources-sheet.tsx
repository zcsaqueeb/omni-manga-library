"use client";

import { ExternalLink, Globe, ShieldAlert, Shuffle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CATALOG } from "@/lib/sources/catalog";
import { sourceCatalog } from "@/lib/sources";
import { useApp } from "@/store/app-store";
import type { Category } from "@/lib/sources/types";

const GROUPS: { key: Category; title: string; hint: string }[] = [
  { key: "manga", title: "Manga & Manhwa", hint: "Scanlation groups + aggregators" },
  { key: "comic", title: "Comics", hint: "Comic archives & download sites" },
  { key: "book", title: "Books", hint: "Public-domain libraries" },
  { key: "novel", title: "Novels & Web Fiction", hint: "Wattpad, light novels, web serials, fanfic" },
  { key: "audiobook", title: "Audiobooks", hint: "LibriVox — narrated classics, play in-app" },
  { key: "official", title: "Official Platforms", hint: "Storefronts — open externally, never scraped" },
];

const ADAPTER_INFO = new Map(sourceCatalog().map((s) => [s.id, s]));

export function SourcesSheet() {
  const { sourcesOpen, setSourcesOpen, disabledSources, toggleSource, adult, setAdult } = useApp();

  return (
    <Sheet open={sourcesOpen} onOpenChange={setSourcesOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3.5">
          <SheetTitle className="flex items-center justify-between text-base">
            Sources ({CATALOG.length})
            <span className="flex items-center gap-2 pr-6">
              <span className={`flex items-center gap-1.5 text-xs font-medium ${adult ? "text-destructive" : "text-muted-foreground"}`}>
                <ShieldAlert className={`size-4 ${adult ? "text-destructive" : ""}`} aria-hidden />
                18+
              </span>
              <Switch
                checked={adult}
                onCheckedChange={setAdult}
                aria-label="Toggle 18+ adult content"
              />
            </span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Toggle sources on/off — disabled ones are skipped in every search. 18+ sources stay hidden
            completely while the adult switch is off.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-4 py-4">
            {adult && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Adult mode is <strong>on</strong> — 18+ sources and titles are now visible. Turn it
                  off any time to hide them again.
                </span>
              </div>
            )}

            {GROUPS.map((group) => {
              const entries = CATALOG.filter((c) => c.category === group.key);
              if (!entries.length) return null;
              return (
                <div key={group.key} className="mb-5">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold">{group.title}</h3>
                    <span className="text-[10px] text-muted-foreground">{group.hint}</span>
                  </div>
                  <Separator className="mb-2.5" />
                  <div className="space-y-1">
                    {entries.map((entry) => {
                      const hasAdapter = !!entry.adapterId && ADAPTER_INFO.has(entry.adapterId);
                      const disabled = disabledSources.includes(entry.adapterId ?? entry.id);
                      const hidden = entry.nsfw && !adult;
                      if (hidden && !hasAdapter) return null;
                      return (
                        <div
                          key={entry.id}
                          className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${disabled ? "opacity-50" : ""}`}
                        >
                          <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 truncate text-xs font-medium sm:text-sm">
                              {entry.name}
                              {entry.nsfw && <Badge variant="destructive" className="px-1 py-0 text-[8px]">18+</Badge>}
                              {hasAdapter && ADAPTER_INFO.get(entry.adapterId!)?.beta && (
                                <Badge variant="outline" className="px-1 py-0 text-[8px] text-amber-500">beta</Badge>
                              )}
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground sm:text-[11px]">
                              {hasAdapter ? "Live search" : entry.note ?? "Open site — no built-in scraper"}
                            </p>
                          </div>
                          {hasAdapter && (
                            <Switch
                              checked={!disabled}
                              onCheckedChange={() => toggleSource(entry.adapterId!)}
                              aria-label={`${disabled ? "Enable" : "Disable"} ${entry.name}`}
                            />
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 shrink-0"
                            asChild
                          >
                            <a href={entry.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${entry.name}`}>
                              <ExternalLink className="size-3.5" aria-hidden />
                            </a>
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="mt-2 rounded-lg border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                <Shuffle className="size-3.5" aria-hidden />
                Domains rotate often
              </p>
              Scanlation groups move domains frequently. The <strong>Keiyoushi extension repo for
              Mihon/Tachiyomi</strong> (keiyoushi.github.io) tracks every group&apos;s current
              domain — if a source shows offline here, open its site from the external-link button or
              check the repo for the new address.
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/** Card grid for the Official tab — link-out only, nothing is scraped. */
export function OfficialGrid() {
  const official = CATALOG.filter((c) => c.official);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5 xl:grid-cols-6">
      {official.map((entry) => (
        <div key={entry.id} className="group relative overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-full flex-col p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open ${entry.name} in a new tab`}
          >
            <div className="mb-2.5 flex aspect-[2/1.2] items-center justify-center rounded-lg bg-gradient-to-br from-violet-900/40 to-fuchsia-900/30">
              <ExternalLink className="size-5 text-white/70 transition-transform group-hover:scale-110" aria-hidden />
            </div>
            <p className="line-clamp-1 text-xs font-semibold sm:text-sm">{entry.name}</p>
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
              Official platform — opens in a new tab
            </p>
          </a>
        </div>
      ))}
    </div>
  );
}
