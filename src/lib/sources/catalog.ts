import type { CatalogEntry } from "./types";

/**
 * The full source catalogue — 105 sites from the master list plus the core
 * library sources. Sources with an `adapterId` are wired to a live adapter;
 * everything else is offered as a one-tap "open site" entry (official
 * storefronts are never scraped). Domains rotate often in this space — the
 * Sources sheet notes the Keiyoushi/Mihon extension repo as the canonical
 * place to confirm a group's current domain, and adapters try mirrors.
 */
export const CATALOG: CatalogEntry[] = [
  // ─────────────────────────── Scanlation groups (unofficial, live 2026-10) ───────────────────────────
  { id: "asurascans", name: "AsuraScans", category: "manga", url: "https://asurascans.com", adapterId: "asurascans", beta: true, note: "Largest manhwa group — reads in-app" },
  { id: "drakecomic", name: "DrakeComic", category: "manga", url: "https://drakecomic.net", adapterId: "drakecomic", beta: true },
  { id: "flamecomics", name: "FlameComics", category: "manga", url: "https://flamecomics.xyz" },
  { id: "genztoons", name: "GenzToons", category: "manga", url: "https://genztoons.org" },
  { id: "hijalascans", name: "Hijala Scans", category: "manga", url: "https://hijala.com", note: "Arabic group" },
  { id: "mangadex", name: "MangaDex", category: "manga", url: "https://mangadex.org", adapterId: "mangadex", note: "Official open API" },
  { id: "mangafire", name: "MangaFire", category: "manga", url: "https://mangafire.to", note: "Bot-walled for servers — open the site directly" },
  { id: "mangakakalot", name: "MangaKakalot", category: "manga", url: "https://kakamanga.com" },
  { id: "mangatx", name: "MangaTx", category: "manga", url: "https://mangatx.com", nsfw: true },
  { id: "qiscans", name: "QiScans", category: "manga", url: "https://qimanga.com" },
  { id: "scythescans", name: "ScytheScans", category: "manga", url: "https://scythescans.com" },
  { id: "thunderscans", name: "ThunderScans", category: "manga", url: "https://thunderscans.com" },
  { id: "toonily", name: "Toonily", category: "manga", url: "https://toonily.com", adapterId: "toonily", nsfw: true, beta: true },
  { id: "vortexscans", name: "VortexScans", category: "manga", url: "https://vortexscans.org" },
  { id: "webtoon", name: "WEBTOON", category: "official", url: "https://www.webtoons.com", official: true, note: "Official platform" },
  { id: "weebcentral", name: "WeebCentral", category: "manga", url: "https://weebcentral.com", adapterId: "weebcentral", note: "Fast SSR reader — reads in-app" },
  { id: "bunmanga", name: "BunManga", category: "manga", url: "https://bunmanga.com" },
  { id: "comix", name: "Comix", category: "manga", url: "https://comix.to" },
  { id: "manhuaplus", name: "ManhuaPlus", category: "manga", url: "https://manhuaplus.org", adapterId: "manhuaplus", beta: true, note: "Browse the home grid" },
  { id: "manhuatop", name: "ManhuaTop", category: "manga", url: "https://manhuatop.org", adapterId: "manhuatop", beta: true },
  { id: "mangaread", name: "MangaRead", category: "manga", url: "https://www.mangaread.org", adapterId: "mangaeffect", beta: true, note: "Ex-MangaEffect — same catalogue" },
  { id: "zeroscans", name: "ZeroScans", category: "manga", url: "https://zeroscans.com" },
  { id: "xcalibrscans", name: "XcalibrScans", category: "manga", url: "https://xcalibrscans.com" },
  { id: "lhtranslation", name: "LHTranslation", category: "manga", url: "https://lhtranslation.net" },
  { id: "dragontea", name: "Dragon Tea", category: "manga", url: "https://dragontea.ink" },
  { id: "boredomsociety", name: "BoredomSociety", category: "manga", url: "https://boredomsociety.xyz" },
  { id: "archive-manga", name: "IA Manga Scans", category: "manga", url: "https://archive.org", adapterId: "archive-manga", note: "Public-domain manga scans — CBZ read in-app" },

  { id: "reaperscans", name: "ReaperScans", category: "manga", url: "https://reaper-scans.com", note: "Rate-limits servers — open the site directly" },
  { id: "kunmanga", name: "KunManga", category: "manga", url: "https://kunmanga.com", nsfw: true },
  { id: "manhwaclan", name: "ManhwaClan", category: "manga", url: "https://manhwaclan.com", nsfw: true },

  // ─────────────────────────── Official platforms — comics & manga ───────────────────────────
  { id: "marvel", name: "Marvel Unlimited", category: "official", url: "https://www.marvel.com/unlimited", official: true },
  { id: "dcuniverse", name: "DC Universe Infinite", category: "official", url: "https://www.dcuniverseinfinite.com", official: true },
  { id: "comixology", name: "ComiXology (Amazon)", category: "official", url: "https://www.amazon.com/kindle-dbs/comixology/home", official: true },
  { id: "globalcomix", name: "GlobalComix", category: "official", url: "https://globalcomix.com", official: true },
  { id: "darkhorse", name: "Dark Horse Digital", category: "official", url: "https://digital.darkhorse.com", official: true },
  { id: "imagecomics", name: "Image Comics", category: "official", url: "https://imagecomics.com", official: true },
  { id: "mangaplus", name: "Shonen Jump / MangaPlus", category: "official", url: "https://mangaplus.shueisha.co.jp", official: true },
  { id: "viz", name: "VIZ Media", category: "official", url: "https://www.viz.com", official: true },
  { id: "kmanga", name: "K Manga (Kodansha)", category: "official", url: "https://kmanga.kodansha.com", official: true },
  { id: "mangaup", name: "MangaUp!", category: "official", url: "https://global.manga-up.com", official: true },
  { id: "lezhin", name: "Lezhin Comics", category: "official", url: "https://www.lezhinus.com", official: true },
  { id: "tapas", name: "Tapas", category: "official", url: "https://tapas.io", official: true },
  { id: "tappytoon", name: "Tappytoon", category: "official", url: "https://www.tappytoon.com", official: true },
  { id: "bilibilicomics", name: "BiliBili Comics", category: "official", url: "https://www.bilibilicomics.com", official: true },
  { id: "pocketcomics", name: "Pocket Comics", category: "official", url: "https://www.pocketcomics.com", official: true },
  { id: "copincomics", name: "Copin Comics", category: "official", url: "https://copincomics.com", official: true },
  { id: "kakaopage", name: "Kakaopage", category: "official", url: "https://page.kakao.com", official: true },
  { id: "toptoon", name: "Toptoon", category: "official", url: "https://toptoon.com", official: true },

  // ─────────────────────────── Official platforms — novels & books ───────────────────────────
  { id: "bookwalker", name: "BookWalker", category: "official", url: "https://global.bookwalker.jp", official: true },
  { id: "jnovelclub", name: "J-Novel Club", category: "official", url: "https://j-novel.club", official: true },
  { id: "yenpress", name: "Yen Press", category: "official", url: "https://yenpress.com", official: true },
  { id: "kindle", name: "Kindle Store", category: "official", url: "https://www.amazon.com/kindle-store-ebooks", official: true },
  { id: "kobo", name: "Kobo", category: "official", url: "https://www.kobo.com", official: true },
  { id: "googleplaybooks", name: "Google Play Books", category: "official", url: "https://play.google.com/store/books", official: true },
  { id: "radish", name: "Radish", category: "official", url: "https://radishfiction.com", official: true },
  { id: "dreame", name: "Dreame", category: "official", url: "https://www.dreame.com", official: true },
  { id: "wuxiaworld", name: "Wuxiaworld", category: "official", url: "https://www.wuxiaworld.com", official: true },

  // ─────────────────────────── Comic books (unofficial) ───────────────────────────
  { id: "getcomics", name: "GetComics", category: "comic", url: "https://getcomics.info", adapterId: "getcomics", note: "CBZ/PDF downloads" },
  { id: "archive", name: "Internet Archive", category: "comic", url: "https://archive.org", adapterId: "archive", note: "Comic archives — CBZ/PDF read in-app" },
  { id: "readcomicsonline", name: "ReadComicsOnline", category: "comic", url: "https://readcomicsonline.ru" },
  { id: "viewcomics", name: "ViewComics", category: "comic", url: "https://viewcomics.me" },

  // ─────────────────────────── Light novels & web novels ───────────────────────────
  { id: "novelupdates", name: "NovelUpdates", category: "novel", url: "https://www.novelupdates.com", adapterId: "novelupdates", beta: true, note: "Index/tracking — chapters live on linked sites" },
  { id: "royalroad", name: "Royal Road", category: "novel", url: "https://www.royalroad.com", adapterId: "royalroad", beta: true },
  { id: "scribblehub", name: "Scribble Hub", category: "novel", url: "https://www.scribblehub.com", adapterId: "scribblehub", beta: true },
  { id: "novelbin", name: "NovelBin", category: "novel", url: "https://novelbin.com", adapterId: "novelbin", beta: true },
  { id: "lightnovelpub", name: "LightNovelPub", category: "novel", url: "https://www.lightnovelpub.com", adapterId: "lightnovelpub", beta: true },
  { id: "novelhall", name: "NovelHall", category: "novel", url: "https://www.novelhall.com" },
  { id: "mtnovel", name: "MTNovel", category: "novel", url: "https://www.mtlnovel.com", adapterId: "mtnovel", beta: true },
  { id: "ao3", name: "Archive of Our Own", category: "novel", url: "https://archiveofourown.org", adapterId: "ao3", beta: true },
  { id: "fanfiction", name: "FanFiction.net", category: "novel", url: "https://www.fanfiction.net", adapterId: "fanfiction", beta: true },
  { id: "wattpad", name: "Wattpad", category: "novel", url: "https://www.wattpad.com", adapterId: "wattpad", note: "The largest web-fiction community — reads in-app" },
  { id: "wikisource", name: "Wikisource", category: "novel", url: "https://en.wikisource.org", adapterId: "wikisource", note: "Wikimedia's proofread public-domain library" },
  { id: "webnovel", name: "Webnovel (Qidian)", category: "novel", url: "https://www.webnovel.com", adapterId: "webnovel", note: "Qidian's catalogue — chapters read in-app with Read & Download" },

  // ─────────────────────────── Audiobooks ───────────────────────────
  { id: "librivox", name: "LibriVox", category: "audiobook", url: "https://librivox.org", adapterId: "librivox", note: "Free public-domain audiobooks, narrated by volunteers" },
  { id: "ia-audio", name: "IA Audio Books", category: "audiobook", url: "https://archive.org/details/audiobooks", adapterId: "ia-audio", note: "Community audiobook archive — Hindi, Urdu & dozens more languages" },

  // ─────────────────────────── Core library sources (always on) ───────────────────────────
  { id: "gutenberg", name: "Project Gutenberg", category: "book", url: "https://www.gutenberg.org", adapterId: "gutenberg", note: "70k+ public-domain books" },
  { id: "openlibrary", name: "Open Library", category: "book", url: "https://openlibrary.org", adapterId: "openlibrary" },
  { id: "standardebooks", name: "Standard Ebooks", category: "book", url: "https://standardebooks.org", adapterId: "standardebooks", note: "Beautifully formatted public domain" },
  { id: "archive-books", name: "IA Books", category: "book", url: "https://archive.org", adapterId: "archive-books" },
];

export const OFFICIAL_ENTRIES = CATALOG.filter((c) => c.official);
