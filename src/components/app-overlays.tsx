"use client";

import { DownloadsSheet } from "@/components/downloads-sheet";
import { LibrarySheet } from "@/components/library-sheet";
import { Reader } from "@/components/reader";
import { SourcesSheet } from "@/components/sources-sheet";

/** Overlays shared by every page — header buttons and the reader work
 * identically on the home grid and on full-page title views. */
export function AppOverlays() {
  return (
    <>
      <LibrarySheet />
      <DownloadsSheet />
      <SourcesSheet />
      <Reader />
    </>
  );
}
