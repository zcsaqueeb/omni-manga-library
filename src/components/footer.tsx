"use client";

import { BrandLogo } from "@/components/brand-logo";
import { Separator } from "@/components/ui/separator";

const SOURCE_LINKS = [
  { label: "MangaDex", url: "https://mangadex.org" },
  { label: "Internet Archive", url: "https://archive.org" },
  { label: "Project Gutenberg", url: "https://www.gutenberg.org" },
  { label: "Standard Ebooks", url: "https://standardebooks.org" },
  { label: "Keiyoushi (source domains)", url: "https://keiyoushi.github.io" },
];

export function AppFooter() {
  return (
    <footer className="safe-bottom mt-auto border-t bg-card/40">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <BrandLogo className="size-7 rounded-md" aria-hidden />
            <div>
              <p className="text-sm font-semibold">OmniLibrary</p>
              <p className="text-xs text-muted-foreground">Read &amp; download from public sources</p>
            </div>
          </div>

          <nav aria-label="Content sources" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {SOURCE_LINKS.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </div>

        <Separator className="my-4" />

        <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
          Content is fetched live from public APIs and public pages of the sources above — nothing
          is hosted here. Official storefronts are linked out and never scraped. Manga chapters are
          packaged as CBZ for personal offline reading; books are public-domain files (EPUB / PDF /
          text). 18+ material only appears when the adult switch is explicitly enabled and stays
          hidden by default. Please respect each source&apos;s terms of use, support official
          releases, and keep personal use personal.
        </p>
      </div>
    </footer>
  );
}
