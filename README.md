# Cosmos

> Turn documents into living knowledge graphs. Read less, understand more.

Cosmos is an editorial-grade reading and research workspace. Drop in a PDF, DOCX, arXiv URL, or a code repository and Cosmos parses it into a navigable **concept graph** — nodes for every idea, edges for every relationship, clustered and ranked so the structure of the document becomes visible at a glance.

Built with **Next.js 15 · React 19 · Drizzle · PostgreSQL · Better Auth**.

---

## Highlights

- **Multi-format ingestion** — PDF (with embedded images & internal links), DOCX, arXiv URLs, and source code (via `tree-sitter`).
- **Concept graphs** — AI-extracted entities, Leiden clustering, PageRank importance, co-occurrence edges, and cross-document relationships.
- **Cross-document graph** — 10+ related documents become a single navigable knowledge map, enabling cross-literature relationship discovery, structural memory, and research gap identification.
- **Editable mind map & argument skeleton** — LLM-generated chapter / claim outlines, fully editable in the board.
- **Original-text-anchored reading** — every graph node points back to the exact paragraph in the source, with click-to-locate and live highlighting.
- **Code-aware board** — parse, visualise, and edit code repositories as a knowledge graph.
- **AI assistance** — Q&A, explain a concept, enrich a graph, recluster, or rewrite a section.
- **Project organization** — folders, tags, and a 50-snapshot version history with one-click rollback.
- **Read-only sharing** — public links for both projects and concept graphs.
- **Editorial UI** — magazine-grade typography, no rounded corners, no shadows, monochrome palette, and skeleton screens on every page.
- **i18n** — English & Simplified Chinese out of the box.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, RSC) |
| Runtime | React 19 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4, editorial design system |
| Database | PostgreSQL 16 (Drizzle ORM) — auto driver: Neon HTTP or `pg` pool |
| Auth | [Better Auth](https://www.better-auth.com) — email + password (6-digit code) & Google OAuth |
| Storage | Cloudflare R2 (S3-compatible) — source images, embedded PDF images |
| AI | OpenAI-compatible chat completion API |
| Graph rendering | React Flow (`@xyflow/react`) with cytoscape fallback |
| Code parsing | `web-tree-sitter` |
| PDF parsing | `pdfjs-dist` |
| DOCX parsing | `mammoth` |
| Email | Resend |
| Animation | GSAP, Motion |

---

## Project Structure

```
src/
├── app/                        # Next.js App Router
│   ├── (landing)               # / — marketing landing
│   ├── dashboard/              # /dashboard — global KG + project list
│   ├── import/                 # /import — PDF / DOCX / URL ingestion
│   ├── code-import/            # /code-import — code repo ingestion
│   ├── board/                  # /board/[id] — main editing canvas
│   ├── codeboard/              # /codeboard/[id] — code project board
│   ├── graph/                  # /graph — global cross-document graph
│   │   ├── compare/            # /graph/compare — diff two graphs
│   │   └── share/[shareId]/    # public shared graph (read-only)
│   ├── share/[shareId]/        # public shared project (read-only)
│   ├── settings/               # /settings — user preferences
│   └── api/                    # route handlers
│       ├── auth/               # Better Auth
│       ├── ingest/             # document → DB
│       ├── concept-graph/      # KG pipeline + queries
│       ├── projects/           # project CRUD, versions, organization
│       ├── qa/                 # Q&A over a project
│       ├── explain/            # explain a single concept
│       └── ...
├── components/
│   ├── board/                  # canvas, sidebar, ingestion UI, panels
│   ├── graph/                  # global graph canvas, filters, toolbar
│   ├── dashboard/              # global KG + organization dialog
│   ├── landing/                # hero, manifesto, use-cases, footer
│   ├── skeleton/               # server-side skeleton screens
│   └── ...
├── lib/
│   ├── graph/                  # concept-extract, leiden, pagerank, …
│   ├── auth.ts                 # Better Auth setup
│   ├── db.ts                   # Drizzle driver auto-selection
│   ├── pdf-to-html.ts          # PDF → 1:1 HTML (images, internal links)
│   ├── docx-to-html.ts         # DOCX → structured HTML
│   ├── storage.ts              # R2 helpers
│   ├── rate-limit.ts
│   └── ...
├── db/schema.ts                # Drizzle schema (single source of truth)
├── hooks/useIngestionFlow.ts   # the only place that drives ingest
├── i18n.ts
├── middleware.ts               # cookie-based auth gate
└── types/
```

---

## Quick Start

### Prerequisites

- **Node.js 20+**
- **Docker** (for the bundled local PostgreSQL — recommended)
- An **OpenAI-compatible** chat-completion API key
- A **Cloudflare R2** bucket (for PDF / DOCX image storage)
- Optional: a **Resend** API key for transactional email

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy the example file and fill in the secrets you need:

```bash
cp .env.example .env
```

Minimum required:

```env
DATABASE_URL="postgres://smartreader:smartreader@localhost:5432/smartreader"
BETTER_AUTH_SECRET="<openssl rand -base64 32>"
APP_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
OPENAI_API_KEY="<your-key>"
OPENAI_BASE_URL="https://api.openai.com/v1"
R2_ENDPOINT_URL="https://<account>.r2.cloudflarestorage.com"
R2_ACCESS_KEY_ID="<key>"
R2_SECRET_ACCESS_KEY="<secret>"
R2_BUCKET_NAME="<bucket>"
R2_PUBLIC_URL="https://pub-<id>.r2.dev"
```

See [.env.example](.env.example) for the full list, including optional Google OAuth and Resend credentials.

### 3. Start the database

```bash
docker compose up -d
docker compose ps   # wait for "healthy"
```

### 4. Push the schema

```bash
npm run db:push
```

### 5. Run the dev server

```bash
npm run dev
```

Open <http://localhost:3000>.

---

## Database

Local development uses the bundled [docker-compose.yml](docker-compose.yml) — **PostgreSQL 16-alpine** on `localhost:5432`, user/db `smartreader`.

[src/lib/db.ts](src/lib/db.ts) auto-selects the Drizzle driver from `DATABASE_URL`:

| Hostname | Driver |
|---|---|
| `*.neon.tech` / `*.neon.com` / `*.neon.build` | Neon HTTP (`@neondatabase/serverless`) |
| everything else | `pg` (node-postgres) pool |

Neon cloud is **not** required for local dev.

---

## Architecture Notes

- **Auth** — Better Auth with email + 6-digit verification code flow, Google OAuth, and 6-digit password reset. Middleware ([src/middleware.ts](src/middleware.ts)) only checks for cookie presence; full session validation runs in each route via `auth.api.getSession`.
- **Ingestion** — `useIngestionFlow` is the single source of truth for the entire lifecycle (parse → KG pipeline → job polling → navigation). All ingest progress writes to the DB serially to prevent race conditions.
- **Knowledge graph pipeline** — 3 fully parallel LLM calls: concept extraction, mind-map sections, argument skeleton. Cancelling an in-flight job aborts the POST, the per-poll GET, and pings a cancel endpoint; the server checks the job's `status` at every progress boundary.
- **Original-text panel** — PDFs are parsed by `pdfjs-dist` into 1:1 HTML with absolute positioning, embedded images uploaded to R2, internal `<a>` links resolved against a `document_links` table. Cross-document references are matched via title/author/DOI fingerprinting.
- **Graph rendering** — Custom shortest-path edge algorithm (lines connect node circles, not handles). Single handle per node, lines originate from different positions to avoid clumping. Obsidian-style hover spotlight: non-incident nodes/edges fade to ~8% opacity, connected edges thicken to 1.2× (capped at 1.5px).
- **Force layout** — `clusterForceDirectedLayout` on dashboard (document cluster circles) and `simpleForceDirectedLayout` on the board (no clusters). Force parameters (repulsion, link distance, collision, centripetal, intra-cluster pull) are user-adjustable in the toolbar.
- **Internationalization** — All user-facing strings live in [src/locales/en.json](src/locales/en.json) and [src/locales/zh.json](src/locales/zh.json). `I18nHydrationGate` prevents React-i18next hydration mismatches.
- **Skeleton screens** — Server Components (no `'use client'`, no `useTranslation`) for every route; editorial palette `#F9F8F6` + `#1C1C1C` blocks at `/8` and `/10` opacity.
- **i18n-aware AI** — AI responses follow the user's preferred output language, falling back to browser `Accept-Language`.

---

## Available Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server (with Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Next.js / ESLint |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check (CI) |
| `npm run db:push` | Sync the Drizzle schema to the database |
| `npm run db:studio` | Open Drizzle Studio |

---

## License

Private project — all rights reserved.
