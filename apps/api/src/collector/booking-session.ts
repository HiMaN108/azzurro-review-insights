import type { Browser, BrowserContext, Page } from 'playwright';
import { BlockedError, ContractChangedError, TransientError } from './collector.errors.js';
import { sleep } from './retry.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** Selectors we depend on. Centralised so a Booking redesign is a one-file fix. */
export const SEL = {
  scoreComponent: '[data-testid="review-score-component"]',
  openReviews: '[data-testid="fr-read-all-reviews"], [data-testid="review-score-link"]',
  reviewCard: '[data-testid="review-card"]',
  nextPage: 'button[aria-label="Next page"]',
  sorter: '[data-testid="review-sorter"], [data-testid="reviews-sorter-component"]',
} as const;

/** The ReviewList GraphQL request exactly as the page sent it. */
export interface ReviewListTemplate {
  url: string;
  body: { operationName: string; variables: { input: Record<string, unknown> } & Record<string, unknown> } & Record<string, unknown>;
}

/**
 * One browser context per property page. Loading the real page lets Chromium solve the
 * AWS WAF JavaScript challenge; subsequent API calls are made from inside the page so they
 * carry the same cookies/origin as a normal visitor.
 */
export class BookingSession {
  /** Most recent ReviewList request seen on this page (listener lives for the whole session). */
  private template: ReviewListTemplate | null = null;

  private constructor(
    private readonly context: BrowserContext,
    readonly page: Page,
  ) {
    page.on('request', (req) => {
      const data = req.postData();
      if (!data?.includes('"operationName":"ReviewList"')) return;
      try {
        this.template = { url: req.url(), body: JSON.parse(data) };
      } catch {
        /* ignore malformed */
      }
    });
  }

  static async open(browser: Browser, url: string): Promise<BookingSession> {
    const context = await browser.newContext({
      locale: 'en-GB',
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 900 },
      timezoneId: 'Australia/Sydney',
    });
    const page = await context.newPage();
    // Skip heavy assets: faster, and fewer requests to Booking.
    await page.route('**/*', (route) =>
      ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue(),
    );
    const session = new BookingSession(context, page);
    try {
      await session.load(url);
    } catch (err) {
      await session.close();
      throw err;
    }
    return session;
  }

  private async load(url: string) {
    const pageUrl = url.replace(/\.html$/, '.en-gb.html');
    let response;
    try {
      response = await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (err) {
      throw new TransientError(`Navigation failed: ${(err as Error).message}`);
    }
    if (response && response.status() >= 500) throw new TransientError(`HTTP ${response.status()}`);

    // The WAF challenge page reloads itself into the real page once solved.
    const ok = await this.page
      .waitForSelector(SEL.scoreComponent, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      const html = (await this.page.content()).toLowerCase();
      if (html.includes('captcha') || html.includes('awswaf') || html.includes('challenge')) {
        throw new BlockedError('Bot-protection challenge was not passed');
      }
      throw new ContractChangedError(`Review score component not found on ${pageUrl}`);
    }
  }

  /** Opens the reviews panel and returns the ReviewList request the page fired (or null). */
  async openReviewsAndCapture(attempts = 3, waitMs = 8_000): Promise<ReviewListTemplate | null> {
    if (this.template) return this.template;
    // Clicking before React hydrates does nothing, so wait for the page to settle first.
    await this.page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
    await sleep(2_000);
    const triggers = [
      ...SEL.openReviews.split(',').map((s) => this.page.locator(s.trim())),
      this.page.getByRole('button', { name: /read all reviews/i }),
      this.page.getByRole('link', { name: /read all reviews/i }),
    ];
    for (let attempt = 0; attempt < attempts && !this.template; attempt++) {
      for (const trigger of triggers) {
        const el = trigger.first();
        if (!(await el.count().catch(() => 0))) continue;
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.click({ timeout: 10_000 }).catch(() => {});
        const deadline = Date.now() + waitMs;
        while (!this.template && Date.now() < deadline) await sleep(250);
        if (this.template) return this.template;
      }
      await sleep(2_000);
    }
    return this.template;
  }

  /** POST to Booking's GraphQL endpoint from inside the page context. */
  async graphql<T = unknown>(url: string, body: unknown): Promise<T> {
    const res = await this.page.evaluate(
      async ({ url, body }) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'include',
        });
        return { status: r.status, text: await r.text() };
      },
      { url, body },
    );
    if (res.status === 202 || res.status === 403 || res.status === 405) throw new BlockedError(`GraphQL HTTP ${res.status}`);
    if (res.status === 429) throw new BlockedError('Rate limited (HTTP 429)');
    if (res.status >= 500) throw new TransientError(`GraphQL HTTP ${res.status}`);
    if (res.status !== 200) throw new ContractChangedError(`GraphQL HTTP ${res.status}`);
    try {
      return JSON.parse(res.text) as T;
    } catch {
      throw new ContractChangedError('GraphQL response was not JSON');
    }
  }

  async close() {
    await this.context.close().catch(() => {});
  }
}
