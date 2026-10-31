# OmniLibrary

**Search, read, listen to, and download books, manga, comics, novels, and audiobooks from one place.**

OmniLibrary is a Next.js web application that brings together public catalogs, reader-friendly sources, audiobook collections, and links to official publishers and storefronts. It queries upstream sources on demand rather than maintaining a central content library.

**Live site:** https://omnilibrary.space-z.ai/

> **Content and rights:** OmniLibrary is a discovery and reading interface, not a content host. Availability, formats, and permitted uses are determined by each upstream provider. Respect provider terms, copyright, and local law. Prefer official sources when a title is commercially available.

## Highlights

- **Multi-category discovery** — search manga, comics, books, novels, and audiobooks.
- **Multiple upstream sources** — source adapters normalize results from different public APIs and websites.
- **In-browser reading** — supported chapters can be read with page navigation; supported text and PDF files can be opened in the reader.
- **Audiobooks** — discover audio from supported catalogs and play available tracks in the app.
- **Downloads** — supported sources and formats can provide files such as CBZ, EPUB, PDF, TXT, and MP3. Availability varies by source and title.
- **Official platforms** — the catalog includes links to publisher and storefront websites; official platforms are linked out rather than scraped.
- **Language filters** — language selection is supported for relevant book and audiobook catalogs.
- **Adult-content control** — adult sources and titles are hidden unless the 18+ option is explicitly enabled.
- **Personal library** — signed-in users can keep favorites and reading history; guest usage can use device-local storage.
- **Caching** — shared server-side caches reduce repeated upstream requests and allow stale results to be reused while refreshing.
- **Responsive interface** — built with the Next.js App Router, React, Tailwind CSS, and reusable UI components.

## How it works

1. Search by title and choose a content category.
2. Browse normalized results from the available upstream sources.
3. Open a title to see its details and supported reading options.
4. Read or listen in the browser, or download a format offered by the source.
5. Optionally sign in to keep favorites and reading history associated with an account.

OmniLibrary does not guarantee that every source will be online or that every title will have a reader or downloadable file. Upstream APIs can rate-limit requests, change response formats, or remove content.

## Tech stack

- **Next.js 16** with the App Router and Route Handlers
- **React 19** and **TypeScript**
- **Tailwind CSS 4** and shadcn/ui-style Radix components
- **Zustand** for client-side application state
- **Prisma** with SQLite for accounts, sessions, favorites, and history
- **Bun** for the project's scripts and production standalone server
- **Lucide** icons and **next-themes** for UI details and theme support

## Requirements

- Bun (recommended; the repository includes `bun.lock`)
- Node.js compatible with the installed Next.js version
- A writable filesystem for the SQLite database when using the default local database configuration

Use a persistent disk for SQLite in production. If your hosting platform has an ephemeral filesystem or multiple application instances, configure a durable database/storage strategy before enabling accounts.

## Getting started

```bash
# 1. Install dependencies
bun install

# 2. Configure environment variables (see below)
# 3. Generate the Prisma client and create/update the database
bun run db:generate
bun run db:push

# 4. Start the development server
bun run dev
```

Open http://localhost:3000.

### npm alternative

The scripts are Bun-oriented, but dependency installation can also be attempted with npm:

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

The production `start` script invokes Bun, so use Bun for the documented production workflow unless you update that script.

## Environment configuration

Set environment variables in `.env` at the project root. At minimum, configure the database URL:

```dotenv
DATABASE_URL="file:./dev.db"
```

The default SQLite path is suitable for local development. For production, use a persistent location and verify the path relative to Prisma's runtime working directory. Never commit real credentials or private environment files.

## Available scripts

| Script | Purpose |
| --- | --- |
| `bun run dev` | Start the local Next.js development server on port 3000 |
| `bun run build` | Build the application and assemble the standalone output |
| `bun run start` | Start the assembled standalone server using Bun |
| `bun run lint` | Run ESLint |
| `bun run db:generate` | Generate the Prisma client |
| `bun run db:push` | Push the Prisma schema to the configured database |
| `bun run db:migrate` | Run Prisma migrations in development |
| `bun run db:reset` | Reset the development database; destructive to its data |

**Caution:** `db:push` uses `--accept-data-loss` in this project's script. Review schema changes and back up data before running it against any database that contains important information.

## Repository map

```text
src/
├── app/
│   ├── api/                 # Search, popular titles, details, chapters, images,
│   │                        # downloads, CBZ pages, library, and auth endpoints
│   ├── title/[id]/          # Title details page
│   ├── layout.tsx           # Root layout and metadata
│   ├── page.tsx             # Main discovery page
│   └── globals.css          # Global styling
├── components/              # Header, cards, reader, overlays, library, downloads,
│                            # theme controls, and reusable UI
├── hooks/                   # Client hooks
├── lib/
│   ├── sources/             # Source adapters and catalog
│   ├── auth.ts              # Account/session helpers
│   ├── cache.ts             # Shared server-side caching
│   ├── db.ts                # Prisma database access
│   ├── download.ts          # Download helpers
│   ├── http.ts              # Upstream HTTP utilities
│   ├── file-resolve.ts      # File URL resolution
│   ├── chapter-order.ts     # Chapter/track ordering
│   ├── cbz.ts / zip.ts      # Archive reading and ZIP streaming
│   └── languages.ts         # Language filtering utilities
└── store/
    └── app-store.ts         # Zustand client state

prisma/
└── schema.prisma            # Accounts, sessions, favorites, and history

scripts/                     # Source/API verification and chapter-order checks
public/                      # Icons, logo, and static assets
```

## API routes

The app exposes Next.js Route Handlers under `/api`. The main groups include:

| Route | Role |
| --- | --- |
| `/api/search` | Search a supported category through source adapters |
| `/api/search/stream` | Stream search results where supported |
| `/api/popular` | Fetch popular titles |
| `/api/details` | Fetch title details |
| `/api/chapter` | Resolve supported chapter, text, PDF, or archive-reader payloads |
| `/api/download` | Stream supported source files or package supported chapter pages as CBZ |
| `/api/img` | Proxy supported reader images |
| `/api/cbz/page` | Serve a page from a CBZ archive |
| `/api/library` | Read and update a user's library |
| `/api/library/favorites` | Manage favorites |
| `/api/library/history` | Manage reading history |
| `/api/auth/register` | Create an account |
| `/api/auth/login` | Sign in |
| `/api/auth/logout` | Sign out |
| `/api/auth/me` | Read the current session |
| `/api/cache` | Cache-related endpoint |

Query parameters and supported formats may vary by route; inspect the relevant handler before integrating against it.

## Accounts and privacy

The Prisma schema defines accounts, sessions, favorites, and history entries. Passwords are stored as scrypt hashes, and session tokens are intended to be held in an HTTP-only cookie. Favorites and history are scoped to an account.

Before deploying publicly, review authentication, session expiration and cookie flags, rate limiting, request validation, logging, database backups, and account deletion behavior. Do not treat the README as a security certification.

## Sources and availability

Source integrations live in `src/lib/sources/`. Each adapter handles a provider's search, details, chapter, audio, or file behavior as supported by that provider. The catalog also includes official platforms that are opened externally.

The exact number of working sources and catalog entries can change as providers change their APIs and domains. Treat the live site's source/catalog indicators as the current UI count; a catalog entry does not guarantee that its provider is currently reachable or that it offers every feature.

## Development and checks

```bash
bun run lint
bun run db:generate
bun run build
```

The repository also contains source/API verification scripts and chapter-order checks under `scripts/`. Inspect each script before running it because some verification scripts may contact upstream services.

## Deployment notes

The Next.js configuration uses `output: "standalone"`. The build script copies `.next/static` and `public` into `.next/standalone`; the start script launches `.next/standalone/server.js`.

A typical deployment sequence is:

```bash
bun install
bun run db:generate
bun run db:push
bun run build
bun run start
```

For a public deployment:

- Set `DATABASE_URL` to a persistent database location.
- Confirm that the hosting runtime supports Bun and the configured Next.js standalone output.
- Ensure the writable database path persists across restarts and deployments.
- Add request limits and monitoring for upstream-source and download routes.
- Verify source terms and permissions, especially for proxying images and streaming files.
- Test the deployed environment's timeout and response-size limits for large CBZ/audio/file downloads.
- Keep dependencies updated and run lint/build checks in CI.

## Troubleshooting

- **Search returns no results:** try a different source or category; upstream APIs may be rate-limited or temporarily unavailable.
- **A chapter or image does not load:** the source may have changed its page structure, CDN, or referrer requirements.
- **A download fails:** confirm that the source exposes the requested format and that the hosting platform allows long-running streamed responses.
- **Database errors:** check `DATABASE_URL`, run `bun run db:generate`, and confirm the database directory is writable and persistent.
- **Production startup fails:** rebuild with `bun run build`, then verify the standalone output and Bun runtime.

## Contributing

1. Create a focused branch.
2. Keep provider-specific logic inside the appropriate source adapter.
3. Normalize returned data through the shared source types.
4. Handle upstream failures gracefully and avoid caching transient empty/error responses for long periods.
5. Run lint, build, and relevant verification scripts before submitting changes.
6. Document any new environment variables, source limitations, and deployment requirements.

## License

No license file was included in the inspected repository archive. Unless the project owner adds a license, do not assume that the source code is open-source or that reuse, redistribution, or modification is permitted. Content accessed through upstream providers remains subject to each provider's own rights and terms.
