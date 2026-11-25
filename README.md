# Azzurro Hotels — Booking.com Review Insights

Collects public Booking.com guest reviews for four Azzurro Hotels properties and turns them into a
dashboard that non-technical operations staff can use to answer three questions every week:

1. **How are we doing?** Average guest score this week vs last week, portfolio and per hotel.
2. **What is going wrong (and right)?** Reviews grouped into operational topics — cleanliness,
   check-in, staff, noise, facilities, location, room condition, value, comfort, Wi-Fi — split into
   complaints and praise, with the exact sentences behind every number.
3. **What exactly did guests say?** A filterable review feed (hotel, dates, rating band, topic, text search).

| Property (ops name) | Booking.com page |
|---|---|
| Olympic Hotel Paddington | `hotel/au/olympic-paddington` |
| Potts Point | `hotel/au/venus-potts-point-sydney` |
| Central Sydney | `hotel/au/venus-surry-hills` |
| Darling Harbour | `hotel/au/chateau-de-venus` |

---

## Contents

- [Quick start](#quick-start)
- [Running the collector](#running-the-collector)
- [Architecture](#architecture)
- [How reviews are collected](#how-reviews-are-collected)
- [Data quality controls](#data-quality-controls)
- [How insights are produced](#how-insights-are-produced)
- [AI tagging (optional, free tier)](#ai-tagging-optional-free-tier)
- [Ask the reviews](#ask-the-reviews)
- [Dashboard](#dashboard)
- [API reference](#api-reference)
- [Deployment](#deployment)
- [Known limitations & assumptions](#known-limitations--assumptions)
- [Sample data](#sample-data)

---

## Quick start

**Requirements:** Node.js ≥ 22, pnpm ≥ 10, PostgreSQL ≥ 14.

```bash
pnpm install
cp .env.example .env                      # set DATABASE_URL (see below)
createdb azzurro_reviews                  # or use a hosted Postgres (Neon / Supabase)

pnpm --filter @azzurro/shared build       # shared types/taxonomy
pnpm --filter @azzurro/db build           # Prisma client
pnpm db:migrate                           # create tables
pnpm db:seed                              # insert the 4 properties

pnpm --filter api build
pnpm --filter api exec playwright install chromium   # one-off, ~100 MB
pnpm scrape -- --full                     # first load: full review history (~25 min)

pnpm dev:api                              # API  → http://localhost:4000/health
pnpm dev:web                              # Dashboard → http://localhost:3000
```

No data handy? Load the bundled sample instead of scraping — see [Sample data](#sample-data).

### Environment variables (`.env` at repo root)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string |
| `API_PORT` / `PORT` | `4000` | API port (`PORT` wins, for hosting platforms) |
| `CORS_ORIGIN` | `http://localhost:3000` | Comma-separated dashboard origins |
| `SCRAPE_CRON` | `0 6 * * *` | Scheduled collection, **Sydney time**. Empty disables it |
| `SCRAPE_MAX_PAGES_PER_PROPERTY` | `40` | Safety cap for incremental runs (25 reviews/page) |
| `SCRAPE_MAX_PAGES_FULL` | `400` | Cap for `--full` backfills |
| `SCRAPE_DELAY_MS_MIN` / `_MAX` | `2500` / `6000` | Random polite delay between requests |
| `ADMIN_TOKEN` | — | Required for `POST /collector/run`. Unset = endpoint disabled |
| `LLM_API_KEY` | — | Turns on AI tagging (see [AI tagging](#ai-tagging-optional-free-tier)). Empty = keyword rules only |
| `LLM_BASE_URL` / `LLM_MODEL` | Groq / `openai/gpt-oss-120b` | Any OpenAI-compatible endpoint and model |
| `LLM_BATCH_SIZE` / `LLM_TOKENS_PER_MINUTE` / `LLM_MAX_REVIEWS_PER_RUN` | `8` / `6000` / `500` | Free-tier pacing |
| `GOOGLE_GEMINI_AI_KEY` / `LLM_FALLBACK_MODEL` | — / `gemini-3.5-flash,gemini-flash-lite-latest` | Fallback provider chain (any OpenAI-compatible endpoint via `LLM_FALLBACK_BASE_URL`) |
| `API_URL` (web) | `http://localhost:4000` | Where the dashboard's server components reach the API |

---

## Running the collector

```bash
pnpm scrape                                   # incremental: new reviews + refresh last 14 days
pnpm scrape -- --full                         # walk every page (first load / backfill)
pnpm scrape -- --property olympic-paddington  # one hotel (repeatable flag)
pnpm scrape -- --strategy dom                 # force the fallback strategy (testing)
pnpm classify                                 # (re)tag topics for untagged reviews
pnpm classify -- --all                        # re-tag everything after editing the taxonomy
```

The CLI prints a per-hotel summary table and exits non-zero if any hotel failed, so it can be used
from cron / GitHub Actions. When the API is running, the same collection runs automatically on
`SCRAPE_CRON` and can be triggered manually:

```bash
curl -X POST localhost:4000/collector/run -H "x-admin-token: $ADMIN_TOKEN" \
     -H 'content-type: application/json' -d '{"full": false}'
curl localhost:4000/collector/status          # last run + freshness per hotel
```

Topic classification runs automatically after every collection.

---

## Architecture

```
┌──────────────────────────┐  GET JSON   ┌──────────────────────────────────────┐
│ apps/web  (Next.js 16)   │ ──────────▶ │ apps/api  (NestJS 12)                │
│ Server Components fetch  │             │  metrics · insights · reviews ·      │
│ URL-driven filters       │             │  properties · collector · classifier │
│ Recharts (client)        │             │  cron (Australia/Sydney)             │
└──────────────────────────┘             └───────────────┬──────────────────────┘
                                                         │ Prisma 7 (pg adapter)
               ┌───────────────────────┐                 ▼
 Booking.com ◀─│ Playwright Chromium   │         ┌────────────────┐
   (public     │ GraphQL ▸ DOM fallback│ ──────▶ │ PostgreSQL     │
    pages)     └───────────────────────┘         └────────────────┘
```

pnpm monorepo:

```
apps/
  api/              NestJS API + collector + classifier + CLIs
    src/collector/  booking-session.ts, strategies/{graphql,dom}.strategy.ts,
                    review.normalizer.ts, collector.service.ts, scheduler, controller
    src/classifier/ keyword.classifier.ts (+ tests), classifier.service.ts
    src/metrics/    weekly KPIs & trends (SQL, Sydney week boundaries)
    src/insights/   topic shares, period comparison, generated headlines
    src/reviews/    paginated, filterable feed
    src/cli/        scrape.ts, classify.ts
  web/              Next.js App Router dashboard
packages/
  db/               Prisma schema, migrations, seed, client factory
  shared/           property list, topic taxonomy, sentiment bands, Sydney date helpers
data/sample/        sample review export (JSON + CSV)
```

**Why these choices**

- **NestJS** gives the collector, scheduler and API one process with dependency injection, validation
  and clean module boundaries; the collector is also usable standalone via the CLI.
- **PostgreSQL** — relational data, strong uniqueness constraints for dedupe, and SQL window/
  aggregate functions for weekly metrics in the business time zone. Free hosted tiers exist (Neon).
- **Playwright** — Booking.com is protected by an AWS WAF JavaScript challenge; plain HTTP clients
  are rejected (HTTP 202 + `challenge.js`). A real browser passes it like a normal visitor.
- **Next.js Server Components** — the API URL and data fetching stay on the server; all filter
  state is in the URL, so any view can be bookmarked or pasted into Slack.

### Data model (simplified)

| Table | Purpose |
|---|---|
| `Property` | The 4 hotels; Booking hotel id discovered on first run |
| `Review` | One row per Booking review. Unique `(propertyId, externalId)`; `contentHash`; raw payload |
| `ReviewTopic` | Topic × polarity tags with the matched sentence as evidence; versioned |
| `PropertySnapshot` | Booking's headline score, listable review count and category sub-scores per run |
| `ScrapeRun` | Audit log of every collection: status, strategy, pages, new/updated counts, errors |

---

## How reviews are collected

Booking.com offers no public review API. Its official APIs (Connectivity / Reviews API for channel
managers, Demand API for affiliates) require partner approval, which we don't have. The collector
therefore reads the **public property pages** — the same data any visitor sees.

**Primary strategy — Booking's own review data feed (`graphql.strategy.ts`)**

1. Open the property page in headless Chromium. This solves the AWS WAF challenge and yields a
   normal visitor session. Images/fonts/media are blocked to minimise load on Booking.
2. Click "Read all reviews". The page itself fires a `ReviewList` GraphQL request — we capture that
   exact request (currently a persisted-query hash) **at run time**, so routine Booking deploys that
   change the query hash do not break us.
3. Replay it from inside the page with only `sorter = NEWEST_FIRST`, `skip` and `limit = 25`
   changed. The response is structured JSON: review id, score, date, title, liked/disliked text,
   language, reviewer first name & country, traveller type, room, check-in/out dates, nights,
   hotel reply, helpful votes, plus Booking's category sub-scores.
4. Persist each page immediately (a crash keeps earlier pages).

**Fallback strategy — read the visible review cards (`dom.strategy.ts`)**

Used automatically if the GraphQL contract changes (request not fired, errors, unexpected shape).
It parses `[data-testid="review-card"]` elements and clicks "Next page". It is slower and has no
Booking review id (month-level stay date, no reply), so deduplication falls back to a content hash.
All selectors live in one place (`booking-session.ts → SEL`) so a redesign is a one-file fix.

**Incremental updates**

Reviews are read newest-first. A daily run keeps paging through the last **14 days** (to pick up
late hotel replies and guest edits) and stops at the first page older than that whose reviews are
all already stored. A typical daily run fetches 1–3 pages per hotel in under a minute.

**Politeness & failure handling**

- Hotels are processed sequentially with a random 2.5–6 s delay between requests.
- Each hotel is retried up to 3× with exponential backoff + jitter, each time in a **fresh browser
  context**. Bot-challenge failures back off 4× longer than network errors.
- One hotel failing never stops the others; the run is recorded as `FAILED` or `PARTIAL`
  (pages saved before the error are kept).
- A cross-process guard prevents overlapping runs (cron + manual); runs abandoned for > 2 h are
  expired automatically.
- `/collector/status` and the dashboard's "Reviews updated … ago" badge expose freshness; data older
  than 36 h is flagged as possibly out of date.

---

## Data quality controls

| Risk | Control |
|---|---|
| Duplicate reviews | Unique `(propertyId, externalId)` on Booking's review id. Content-hash matching is used **only** for fallback rows without an id — two genuinely different reviews with identical text (e.g. score-only reviews from guests with the same first name) are both kept. |
| Same review via both strategies | A DOM row is upgraded in place to the real id and richer fields when later seen via GraphQL. |
| Edited reviews | Content hash change → row updated and topics cleared for re-classification. |
| Late hotel replies | 14-day refresh window; reply/vote changes update the row without touching topics. |
| Invalid records | Rejected and counted: score outside 1–10, unparsable or future dates, dates before 2010. |
| **Booking serving a partial list** | Observed during testing: some browser sessions get a list of only ~60 % of a hotel's reviews (Olympic 74 vs 129, Central Sydney 1,468 vs 2,445, Potts Point 1,438 vs 2,385, Darling Harbour 2,526 vs 4,304). Two defences: **(1)** if the list is > 10 % below the largest seen, retry with a fresh session; if it persists, mark the run `PARTIAL` and ignore that snapshot in the dashboard. **(2) Gap detection:** if Booking lists > 5 % more reviews than we store, the run automatically switches from incremental to a full walk and back-fills what earlier runs missed (recovered 473 Potts Point reviews in testing). |
| Privacy | Reviewer avatar URLs (third-party profile links) are stripped before storage; only the first name/country Booking displays publicly is kept. No cookies or credentials are stored or committed. |
| Time zones | All "week" logic uses Australia/Sydney, Monday–Sunday, DST-aware. |

---

## How insights are produced

**Sentiment.** Booking scores are 1–10. Bands follow Booking's own wording:
**Positive ≥ 8**, **Mixed 6–7.9**, **Negative < 6**.

**Topics.** A transparent keyword classifier (`apps/api/src/classifier/keyword.classifier.ts`,
taxonomy in `packages/shared/src/topics.ts`):

- Booking asks guests for **"Liked"** and **"Disliked"** text separately. A topic found in the
  Disliked text is a *complaint*; in the Liked text, *praise*. This gives polarity without guessing
  sentiment from language — the biggest accuracy win available.
- Matching is per sentence, on whole words plus common English inflections (`clean` → `cleaning`,
  but `fee` ✗ `feels`, `host` ✗ `hostel`), with hyphen/space variants (`check-in`, `check in`).
- Empty complaints ("Nothing", "N/A", "All good") are ignored.
- The matched sentence is stored as **evidence** and shown in the UI, so every number can be
  traced back to what a guest actually wrote.
- Tags are versioned (`kw-2`); changing keywords and running `pnpm classify -- --all` re-tags
  everything without re-scraping.

**Metrics** reported per topic and period:

- *Complaint share* — % of all reviews in the period whose Disliked text mentions the topic.
- *Share of negative reviews* — % of reviews scored < 6 that complain about the topic
  (the brief's example: "40 % of negative reviews this week mentioned cleanliness").
- *Change* vs the previous equal-length period, in percentage points.
- *By hotel* counts and the 3 most recent example sentences.

**Generated headlines** are plain-English sentences built from those figures, with guards so they
never overstate a small sample: movements need ≥ 3 mentions and ≥ 5 percentage points, and weeks
with < 10 reviews carry an explicit "small numbers" note. Weekly averages from < 5 reviews are
tagged "Only N reviews" throughout the UI.

**Accuracy.** A manual spot-check of 30 random complaint tags found roughly 3 in 4 clearly correct;
most errors were keyword collisions, which the `kw-2` matcher reduced. Unit tests cover polarity,
empty complaints, variants and false-positive guards (`pnpm --filter api test`).

---

## AI tagging (optional, free tier)

Keyword rules are free and transparent but literal: they miss sarcasm, unusual phrasing and most
non-English reviews. When `LLM_API_KEY` is set, an AI model re-reads reviews and replaces their
keyword tags with richer ones, and flags reviews that **need a manager's attention** (safety,
pests, theft, injury, harassment, legal/refund threats). These appear in a "Needs attention" panel
on the Overview and a filter on the review feed.

**Free setup:** Groq has a free tier (its docs only mention a payment method for upgrading to the paid tier). Create a key at [console.groq.com](https://console.groq.com) → API Keys,
put it in `.env` as `LLM_API_KEY`, then:

```bash
pnpm classify -- --ai --limit 20     # try a small batch first
pnpm classify -- --ai                # up to LLM_MAX_REVIEWS_PER_RUN, newest first
```

After that the daily collection runs it automatically on new reviews.

**Design for free tiers and reliability**

- **Provider-neutral:** any OpenAI-compatible chat endpoint (Groq, OpenRouter, a local Ollama
  `http://localhost:11434/v1`, OpenAI, …) — switch with `LLM_BASE_URL` / `LLM_MODEL`.
- **Structured output:** strict JSON schema (topics restricted to the taxonomy enum), then
  validated again in code — unknown ids/topics/polarities are dropped.
- **No invented quotes:** each evidence quote must appear verbatim in the review; otherwise it is
  discarded and the tag's confidence lowered.
- **Provider fallback:** if the primary (Groq) runs out of free quota, rejects the key or fails 3
  times in a row, the run switches to the fallback chain — by default Google Gemini's
  OpenAI-compatible endpoint (`GOOGLE_GEMINI_AI_KEY`), trying `gemini-3.5-flash` then
  `gemini-flash-lite-latest`. (`gemini-3.8-flash` was tested first but was repeatedly overloaded —
  HTTP 503 "high demand" — on the free tier.) Each review records which model tagged it.
- **Temporary outages:** 5xx / network errors are retried after 5 s, 15 s and 45 s before counting
  as a failure.
- **Self-healing batches:** reasoning models can run out of output room on a large batch
  (observed on the first live run: truncated / `json_validate_failed`). A failed batch is split in
  half and retried (8 → 4 → 2 → 1); a review that still fails alone keeps its keyword tags and leaves
  the queue, so it can't block the rest. `reasoning_effort: "low"` (via `LLM_EXTRA_BODY`) keeps
  replies short, and `LLM_MAX_OUTPUT_TOKENS` is sized so input + cap stays under Groq's 8K TPM.
- **Budget pacing:** paces requests by tokens actually used (`LLM_TOKENS_PER_MINUTE`), retries
  short rate limits, and stops cleanly when the daily quota is exhausted — remaining reviews are
  done on the next run. Newest reviews first, so the current week is covered on day one; on Groq's
  free tier (~200K tokens/day) the full 3-year history backfills over roughly two to three weeks.
- **Fallback:** if the AI is off, failing or out of quota, keyword tags are used. Each review shows
  whether it was "AI-tagged" or "keyword-tagged"; Issues & praise shows the AI coverage for the period.
- Edited reviews are re-queued for AI tagging automatically.
- Unit tests cover prompt building, output validation, quote verification and HTTP error handling
  (no network needed). Verified live on Groq (`openai/gpt-oss-120b`): tags and urgent flags were
  spot-checked by hand, including French and Danish reviews that keyword rules miss.

Note: free tiers may use prompts to improve the provider's models (Google's Gemini free tier says so
explicitly). Reviews are public data, so this is acceptable here; use a paid tier for private data.

---

## Ask the reviews

The **Ask** page lets staff type a question in plain English, e.g. *"How can we improve our rating
at Darling Harbour?"* or *"What should housekeeping focus on this week?"*, and get 3–5 practical
recommendations, each with the reason (numbers from the statistics) and the guest quotes behind it.

**How an answer is built** (`apps/api/src/ask/`)

1. **Statistics for all reviews** in the selected hotels/period (default: last 12 weeks): average
   score vs previous period, % negative, complaint/praise share per topic and its change.
2. **A relevant sample of reviews** (~20–35, capped at ~3K tokens so it fits free-tier per-minute
   limits): questions naming a topic ("check-in", "dirty", "wifi") get reviews about that topic;
   open questions get recent complaints about the biggest issues (round-robin so each is
   represented) plus top-scored reviews to show what's working.
3. **The AI writes the answer** as strict JSON (same provider chain as tagging: Groq → Gemini).
4. **The answer is checked before it is shown:**
   - cited reviews must be ones that were actually sent; the real review text is attached as the quote
     (refs the model writes into its prose are recovered and removed from the text);
   - every percentage must appear in the statistics. If one doesn't, the answer is shown with a
     visible warning. Limitation: this catches invented figures, not a real figure attached to the
     wrong claim;
   - review text is treated as data ("ignore your instructions" in a review or question does nothing;
     off-topic questions get a polite "unrelated to guest reviews").

**Cost & limits:** one question ≈ 5–7K tokens on Groq's free tier. The same question + filters on
the same day returns the saved answer instantly (no AI call). 20 questions per client per hour
(`ASK_RATE_LIMIT_PER_HOUR`). Daily tagging is capped at 300 reviews (`LLM_MAX_REVIEWS_PER_RUN`) so
roughly half the free daily quota stays available for questions. Every Q&A is stored (`AskLog`)
and listed under "Recent questions".

**Prompt lessons from testing:** the first version produced invented "score points" because the
statistics said "+5 pts" (meaning percentage points of reviews); the wording was made explicit and a
rule added that every number must come from the statistics. The model also wrote refs like "(R6)"
inside its text instead of the evidence list, so quotes went missing; that is now recovered
automatically.

| Endpoint | Description |
|---|---|
| `POST /ask` `{question, from?, to?, properties?}` | Answer (cached per question + filters per day) |
| `GET /ask/history?limit=` | Recent questions |
| `GET /ask/:id` | A saved answer |

---

## Dashboard

Three pages, each with a single row of filters (hotels, period) that persist in the URL:

- **Overview** — this week (week to date) vs last week: average rating, number of reviews, % negative,
  hotel reply rate; generated insight sentences; top complaints (each bar links to the reviews);
  hotel-by-hotel table with change, % negative, top issue and Booking's headline score; weekly or
  monthly trends of average rating (optionally per hotel) and positive/mixed/negative counts.
  Previous/next week navigation.
- **Issues & praise** — any period: complaint and praise shares per topic, change vs previous period,
  breakdown by hotel, recent example quotes, and a plain-language explanation of the method and its
  limits.
- **Ask** — natural-language questions answered from the reviews (see [Ask the reviews](#ask-the-reviews)).
- **Read reviews** — the full feed with hotel, period, rating band, topic (complaint or praise),
  free-text search and sort; liked/disliked shown side by side, topic chips with the evidence on
  hover, hotel reply expandable.

Design notes: status colours (better/worse) always come with an arrow and a word; each hotel keeps
the same colour everywhere; every chart has hover tooltips and a "Show as table" view; a header switch offers
Auto (follow device) / Light / Dark themes, remembered per browser; works at phone width; loading skeletons and friendly error states when the API is unreachable.

---

## API reference

All dates are Sydney-local `YYYY-MM-DD` (inclusive). `properties` = comma-separated slugs.

| Endpoint | Description |
|---|---|
| `GET /health` | DB connectivity check |
| `GET /properties` | Hotels + Booking headline score, sub-scores, stored review count |
| `GET /topics` | Topic taxonomy (labels, descriptions, keywords) |
| `GET /metrics/overview?week=&properties=` | Week (containing `week`, default today) vs previous week, portfolio + per hotel |
| `GET /metrics/trends?from=&to=&granularity=week\|month&properties=` | Average score + sentiment counts per period |
| `GET /insights/topics?from=&to=&properties=` | Topic complaint/praise shares, change, examples, headlines (default: current week) |
| `GET /reviews?from=&to=&properties=&sentiment=&topic=&polarity=&q=&sort=&page=&pageSize=` | Paginated feed |
| `GET /collector/status` | Last run and last successful collection per hotel |
| `POST /collector/run` | Start a collection (header `x-admin-token`) |

Invalid parameters return `400` with a readable message.

---

## Deployment

Planned production setup (all have free/low-cost tiers):

| Component | Host | Notes |
|---|---|---|
| Database | Neon / Supabase Postgres | Run `DATABASE_URL=… pnpm db:deploy && pnpm db:seed` once |
| API + collector | Railway / Render / Fly.io | `apps/api/Dockerfile` (Playwright image with Chromium). Set env vars above. The cron runs inside the API. |
| Dashboard | Vercel | Root directory `apps/web`; set `API_URL` to the API's public URL |

Serverless functions are not a good fit for the collector (long-running headless browser), which is
why it lives with the API on a container host. Alternative: run `pnpm scrape` from a scheduled
GitHub Actions job against the hosted database.

> The Dockerfile could not be built locally (no Docker on the development machine); treat it as a
> starting point and verify on first deploy.

---

## Known limitations & assumptions

- **Not an official API.** Collection depends on Booking.com's public pages and an undocumented
  internal request. Booking can change either at any time; the DOM fallback, run-time request
  capture and run-status monitoring reduce but don't remove this risk. Review Booking.com's terms of
  use before production use; the official Connectivity Reviews API via a channel manager would be
  the long-term robust option.
- **Bot protection from cloud servers.** Testing was done from a residential connection. Data-centre
  IPs may face stricter challenges; if runs fail with `BlockedError`, run the collector from a
  different network or add a residential proxy.
- **3-year window.** Booking's review list only goes back ~36 months, so history before that cannot
  be collected. Booking's headline review count can differ from the listable count.
- **Partial-list variant.** See data-quality table — detected and flagged, not fully explained.
- **Keyword classification** (the default) is English-centric and literal: it misses unusual
  phrasing and sarcasm, and non-English reviews (~10 %) are mostly untagged. Optional AI tagging
  addresses this but on a free tier covers ~500 reviews/day, so older history stays keyword-tagged
  until the backfill completes. AI tags can still be wrong; quotes are verified, judgements are not.
- **Small weekly samples.** The four hotels receive ~25 reviews/week combined, so per-hotel weekly
  averages often rest on 1–4 reviews; the UI flags these and offers monthly trends.
- **Reply rate lags** because hotels reply days after a review; recent weeks fill in over time.
- **Score-only reviews** (no text) count towards averages but cannot be topic-tagged.

---

## Sample data

`data/sample/` contains every review collected for the four hotels (Booking's 3-year window):

- `reviews.json` — all fields used by the app (for re-import); topic tags included for reference.
- `reviews.csv` — the same, flattened for Excel / Google Sheets.

Raw Booking payloads and reviewer avatar URLs are not included.

Load it into a fresh database instead of scraping (idempotent — safe to run twice):

```bash
pnpm db:migrate && pnpm db:seed
pnpm --filter @azzurro/db import-sample
pnpm --filter api build && pnpm classify      # generate topic tags
```

Refresh the export after a collection with `pnpm --filter @azzurro/db export-sample`.
