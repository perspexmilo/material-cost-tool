# CutMy Material Cost Tracker — Claude Context

Internal tool for CutMy (sheet material cutting company) to track supplier material costs,
parse price-update emails with AI, stage future-dated changes, and maintain a full audit trail.

## Stack

- **Next.js 16** (App Router, Turbopack) — `proxy.ts` not `middleware.ts`; export is `proxy` not `middleware`
- **TypeScript** — strict mode
- **Tailwind CSS** + shadcn/ui primitives
- **TanStack Query v5** — client-side data fetching
- **Prisma ORM** + **Supabase PostgreSQL** (aws-1-eu-west-3, project zcranwyfwgeeikzqyqgm)
- **Anthropic Claude API** — model `claude-sonnet-4-6`
- **Vercel** — hosting + Cron (daily 06:00 UTC applies staged changes)

## Common Commands

```bash
npm run dev          # dev server (Turbopack)
npx prisma db push   # sync schema to Supabase (uses DIRECT_URL from .env)
npx prisma generate  # regenerate client after schema changes
npx prisma studio    # local DB browser
node scripts/run-import.mjs <path-to-csv>  # bulk CSV import (bypasses auth)
```

> **Prisma generate note**: the dev server holds `query_engine-windows.dll.node`.
> Stop the server before running `prisma generate`, then restart.

## Project Structure

```
app/
  (app)/               # authenticated routes
    database/          # material database browser
    price-updates/     # AI email parser + context hints
    staged-changes/    # pending future-dated changes
  api/
    materials/         # CRUD + bulk-update + CSV import
    parse-email/       # POST — runs AI parser
    parser-context/    # GET/POST/DELETE — context hints for AI
    staged-changes/    # CRUD
    supplier-aliases/  # alias management
    cron/              # Vercel cron endpoint (apply staged changes)
components/
  price-updates/
    PriceUpdateTool.tsx   # left panel: Email + Context tabs
    ContextPanel.tsx      # context hints management UI
    ReviewTable.tsx       # parse results review + commit
lib/
  ai/parser.ts            # Claude extraction + fuzzy material matching
  db/                     # Prisma helpers per entity
  csv/importer.ts         # Metabase + template CSV import
prisma/schema.prisma
types/index.ts
scripts/run-import.mjs    # standalone import (no Next.js/auth)
```

## Key Architectural Decisions

### Material category
- Category is derived from the Magento `Material` attribute (MDF → Wood, Acrylic → Plastic, etc.)
- **Never** derived from SKU structure
- `cts-` SKU prefix = "cut to size" variant — not a structural prefix for all products

### Supplier
- Supplier is not in Magento data — stored separately, linked post-import
- All imported materials default to supplier "Unassigned" and need manual assignment

### Magento fields
- `magentoSku` (unique), `magentoName`, `magentoEntityId` (unique), `variantType` stored on Material
- Foundation for Phase 2 Magento price push

### AI Parser (`lib/ai/parser.ts`)
- Claude extracts structured ranges from the email via tool use
- Matching logic tries: (1) exact alias lookup → (2) fuzzy score against all materials
- Fuzzy match returns **all** materials scoring ≥ 0.6, not just the top one — so "Clear Acrylic +5%"
  resolves to every thickness, not just 2mm
- Short words (≤ 2 chars) are excluded from word-level matching to prevent false positives
  (e.g. "Type A Beading" matching "clear" because "a" is a substring)
- **Context hints** (`parser_context` table) are fetched before each Claude call and appended
  to the system prompt — use them to explain supplier terminology, product naming, etc.

### Authentication
- Supabase Auth (email + password)
- Session handled in `proxy.ts` (Next.js 16 renamed `middleware.ts`)
- `cookies()` must be awaited in Next.js 15+

### Env vars
- `.env` — unquoted values (Prisma + Next.js runtime)
- `.env.local` — quoted values (Next.js dev)
- Both excluded from git

### Cron
- `CRON_SECRET` header verified in `/api/cron/apply-staged-changes`
- Applies all staged changes whose `effectiveDate` is today or earlier

## CSV Import Formats

Two formats auto-detected by column headers:

| Format | Detection column | Source |
|--------|-----------------|--------|
| Metabase export | `entity_id` | Metabase report export |
| Template | `magento_sku` | Manual template |

Metabase columns used: `entity_id`, `Variant Name`, `sku`, `Cost`, `Cost_Width`,
`Cost_Length`, `Thickness`, `Material`, `Type`, `Variant_Type`

## Database Schema (summary)

| Table | Purpose |
|-------|---------|
| `suppliers` | Supplier names |
| `materials` | 2,016+ products with Magento fields |
| `cost_history` | Audit trail of every cost change |
| `staged_changes` | Future-dated changes awaiting cron |
| `supplier_aliases` | Maps supplier range names → material IDs |
| `parser_context` | User-defined hints injected into AI system prompt |

## Gotchas

- Supabase pooler host is `aws-1-eu-west-3` (not `aws-0`) — matters for the connection string
- `entity_id` values in Metabase exports are comma-formatted ("4,059") — strip commas before `parseInt`
- Anthropic client must be instantiated inside a function, not at module level, so the API key
  env var is read at call time (not import time)
- Port 3000 may already be held by a previous dev server process; Next.js will fall back to 3001
