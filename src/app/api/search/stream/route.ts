import { NextRequest } from "next/server";
import { streamSearch } from "@/lib/sources";
import { sanitizeLang } from "@/lib/languages";
import type { Category } from "@/lib/sources/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent-Events search: every source reports in as soon as it answers,
 * so first results paint in well under a second and slow sites never block
 * the page. Event stream:
 *   meta   → source list the query fans out to
 *   source → one source's results (ok=false when it failed/timed out)
 *   done   → final tally
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const type = (sp.get("type") ?? "manga") as Category;
  const limit = Math.max(6, Math.min(48, Number(sp.get("limit") ?? 36) || 36));
  const source = sp.get("source") ?? undefined;
  const nsfw = sp.get("nsfw") === "1";
  const disabled = (sp.get("disabled") ?? "").split(",").filter(Boolean);
  const lang = sanitizeLang(sp.get("lang"));

  if (!q) {
    return new Response("event: done\ndata: {\"total\":0,\"ms\":0}\n\n", {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };

      try {
        for await (const ev of streamSearch(type, q, limit, source, { nsfw, disabled, lang })) {
          if (req.signal.aborted) break;
          send(ev);
        }
      } catch (err) {
        console.error("[api/search/stream]", err);
        send({ t: "done", total: 0, ms: 0, error: true });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
