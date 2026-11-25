Collection strategies (tried in order, per property):

1. `graphql.strategy.ts` — open the property page in headless Chromium (passes the AWS WAF
   JS challenge), then page through Booking's own `ReviewList` GraphQL query from inside the
   page context, newest first. Structured JSON, stable ids, cheapest per review.
2. `dom.strategy.ts` — fallback if the GraphQL contract changes: open the reviews panel and
   parse `[data-testid="review-card"]` elements, clicking through pagination.

Both return `RawReview[]`, normalised by `review.normalizer.ts` into the Prisma shape.
Incremental mode stops paging once a full page contains only already-stored review ids.
