# Material Cost Tracking

> Keeping an eye on competitor prices so you don't have to.

Internal tooling for [Cut My](https://www.cutmy.co.uk) — a material cost tracker and competitor price monitor for sheet materials (acrylic, wood, etc.).

---

## What it does

### 1. Material Cost Database
Track Cut My's own material costs, markup multipliers, and retail prices across the full product range. Import supplier price lists from PDFs and emails using AI parsing — no manual data entry.

- Bulk import from Perspex and Lathams PDF price lists
- AI-powered email parser for supplier price update emails
- Staged changes workflow — review parsed updates before committing them
- Cost history per variant with change tracking
- Searchable, filterable material database

### 2. Peeping Tom — Competitor Price Monitor
Scrape competitor prices for equivalent products and compare them against Cut My's retail price per m².

- Price-per-m² comparison across 6 acrylic competitors
- Week-on-week delta indicators — see when a competitor raises or drops their price
- Filter by variant type (Clear / Black / White / etc.)
- Map each basket item to a Cut My variant for direct retail price comparison
- Average competitor price column
- Covers 16 basket items: Clear Acrylic (2–30mm), Black Acrylic (3mm, 5mm), White Acrylic (3mm, 5mm)

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 App Router |
| Database | Supabase PostgreSQL + Prisma ORM |
| Auth | Supabase Auth |
| Styling | Tailwind CSS |
| Data fetching | TanStack Query v5 |
| AI parsing | Claude (Anthropic) via API |
| Hosting | Vercel |
| Scraper | Playwright (separate package — see below) |

---

## Repo Structure

```
material-cost-tool/         This Next.js app
  app/
    (app)/
      database/             Material cost database
      competitor-prices/    Peeping Tom dashboard
      price-updates/        Supplier price update review tool
      staged-changes/       Staged changes approval queue
    api/
      competitor-prices/    Scrape results API
      materials/            CRUD for material records
      parse-email/          AI email parser
      parse-pdf-*/          AI PDF parsers (Perspex + Lathams)
      staged-changes/       Staged update management
  components/
  lib/
    ai/                     LLM parsing logic
    db/                     Prisma query helpers
```

The **scraper** lives in a sibling directory:

```
competitor-scraper/         Playwright scraper (run locally or on a schedule)
  src/
    scrapers/               One file per competitor
    index.ts                Entry point
    seed.ts                 Basket item seeder
  CLAUDE.md                 Full scraping rules per competitor (for AI context)
```

---

## Competitors Tracked (Acrylic)

| Competitor | Scraper Notes |
|---|---|
| Simply Plastics | Standard Chromium. Colour picker via Bootstrap modal. |
| Plastic People | Standard Chromium. React inputs need native value setter. |
| Cut Plastic Sheeting | Standard Chromium. WooCommerce — real keystrokes required. |
| Sheet Plastics | Stealth Chromium (Cloudflare). Price in `data-price-amount` — no interaction needed. |
| Plastic Sheet Shop | Standard Chromium. Calls site's own `/wp-json/kps/v1/shapes/price` API directly. |
| Plastic Sheets | Stealth Chromium (Cloudflare Turnstile). Button thickness toggle, Knockout.js inputs. |

---

## Running the Scraper

```bash
cd competitor-scraper
npm install
npx playwright install chromium

# Full scrape
npm run scrape

# Targeted scrapes
npm run scrape -- --competitor simply-plastics
npm run scrape -- --colour Black
npm run scrape -- --colour Clear --competitor sheet-plastics
npm run scrape -- --name "3mm"

# Seed new basket items
npx tsx src/seed.ts
```

See `competitor-scraper/CLAUDE.md` for detailed per-competitor scraping rules.

---

## Development

```bash
cd material-cost-tool
npm install
npm run dev
```

Requires a `.env.local` with:

```
DATABASE_URL=
DIRECT_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
```

---

## Roadmap

- [ ] Weekly cron automation for scraper
- [ ] Wood competitors (separate page, different competitor set)
- [ ] More coloured acrylic variants (Mirror, Opal, etc.)
- [ ] Price drop alerts
- [ ] Historical sparkline charts per competitor

Full progress log: [`PROGRESS.md`](../../PROGRESS.md)
