/**
 * Runs once when the server process boots (Next.js instrumentation hook).
 * Pre-warms the shared home-grid cache for the five browse categories so the
 * FIRST visitor gets an instant page — and everyone after them rides the cache.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  void (async () => {
    try {
      await sleep(4_000); // let the server finish booting first
      const { unifiedPopular } = await import("@/lib/sources");
      for (const type of ["manga", "comic", "book", "novel", "audiobook"] as const) {
        try {
          await unifiedPopular(type, 1, 24, { nsfw: false });
        } catch {
          /* a failing category must not block the others */
        }
        await sleep(1_500); // stagger — gentle on upstreams
      }
      console.log("[warmup] shared home-grid cache pre-warmed");
    } catch {
      /* warmup is best-effort */
    }
  })();
}
