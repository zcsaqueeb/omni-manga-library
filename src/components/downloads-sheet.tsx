"use client";

import { CheckCircle2, FileDown, Loader2, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useApp } from "@/store/app-store";

function ago(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function DownloadsSheet() {
  const { downloadsOpen, setDownloadsOpen, downloads, clearDownloads } = useApp();

  return (
    <Sheet open={downloadsOpen} onOpenChange={setDownloadsOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="flex-row items-center justify-between border-b px-4 py-3.5">
          <SheetTitle className="text-base">Downloads</SheetTitle>
          {downloads.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1 text-xs text-muted-foreground"
              onClick={clearDownloads}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Clear
            </Button>
          )}
        </SheetHeader>

        {downloads.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <FileDown className="size-10 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium">No downloads yet</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Manga chapters are packaged as CBZ; books and comics keep their original EPUB / PDF /
              text format.
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-1.5 px-4 py-4">
              {downloads.map((d) => (
                <div key={d.id} className="flex items-center gap-2.5 rounded-lg border bg-card/60 px-3 py-2.5">
                  <span className="shrink-0">
                    {d.status === "downloading" && <Loader2 className="size-4 animate-spin text-primary" aria-hidden />}
                    {d.status === "done" && <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />}
                    {d.status === "error" && <XCircle className="size-4 text-destructive" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium sm:text-sm">{d.title}</p>
                    <p className="text-[10px] text-muted-foreground sm:text-[11px]">{ago(d.startedAt)}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[9px] uppercase ${
                      d.status === "done"
                        ? "border-emerald-500/40 text-emerald-500"
                        : d.status === "error"
                          ? "border-destructive/40 text-destructive"
                          : "text-primary"
                    }`}
                  >
                    {d.kind === "chapter" ? "CBZ" : "File"} {d.status}
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
