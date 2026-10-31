"use client";

import { Globe } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SOURCES_BY_TYPE } from "@/lib/sources";
import { LANGUAGES } from "@/lib/languages";
import { useApp } from "@/store/app-store";
import type { Category } from "@/lib/sources/types";

const TABS: { value: Category; label: string; hint: string }[] = [
  { value: "manga", label: "Manga", hint: "MangaDex + scanlation groups + aggregators" },
  { value: "comic", label: "Comics", hint: "Internet Archive + GetComics" },
  { value: "book", label: "Books", hint: "Gutenberg + Open Library + Standard Ebooks + IA" },
  { value: "novel", label: "Novels", hint: "Wattpad, Wikisource, Royal Road, AO3, FanFiction…" },
  { value: "audiobook", label: "Audiobooks", hint: "LibriVox + IA Audio Books — free audiobooks, play in-app" },
  { value: "official", label: "Official", hint: "Official platforms — open externally" },
];

/** Tabs whose live sources support the language filter. */
const LANG_TABS = new Set<Category>(["audiobook", "book"]);

export function CategoryTabs() {
  const { tab, setTab, sourceFilter, setSourceFilter, lang, setLang, adult, disabledSources } = useApp();

  const sources = (SOURCES_BY_TYPE[tab] ?? [])
    .filter((s) => adult || !s.nsfw)
    .filter((s) => !disabledSources.includes(s.id));

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as Category);
          setSourceFilter("all");
        }}
      >
        <TabsList className="h-10 w-full justify-stretch overflow-x-auto rounded-full p-1 sm:w-auto sm:justify-start">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="h-8 flex-1 rounded-full px-4 text-sm font-medium sm:flex-none"
              title={t.hint}
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab !== "official" && (
        <div className="flex flex-wrap items-center gap-2">
          {LANG_TABS.has(tab) && (
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger
                size="sm"
                className="h-9 min-w-40 rounded-full"
                aria-label="Filter by language"
              >
                <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <SelectValue placeholder="All languages" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All languages</SelectItem>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.label}
                    {l.native ? ` · ${l.native}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger
              size="sm"
              className="h-9 min-w-40 rounded-full"
              aria-label="Filter by source"
            >
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                All sources ({sources.length})
              </SelectItem>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                  {s.nsfw ? " · 18+" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
