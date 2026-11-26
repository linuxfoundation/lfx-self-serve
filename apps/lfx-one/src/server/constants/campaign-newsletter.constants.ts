// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// Campaign newsletter and email search — Server-Only Constants
// ---------------------------------------------------------------------------
//
// Server-only, like `audience-builder.constants.ts` beside it: a model prompt, a text filter and a
// proxy timeout that run exclusively in the BFF. None is part of the UI contract.

/** A web address inside free text, with or without its scheme's usual company (`www.`). */
export const NEWSLETTER_SUGGESTION_TEXT_ADDRESS = /(?:https?:\/\/|www\.)\S+/gi;

/**
 * Lists what a brand's page offers that a newsletter issue could carry. Facts only from the page,
 * links copied from its hrefs (each is then checked against the page), dates as the page states them.
 */
export const NEWSLETTER_SUGGESTIONS_SYSTEM_PROMPT = `You read one web page of an open source foundation or project and list items its next email newsletter could carry.

Return ONLY a JSON array (no markdown fencing), at most 12 items, most useful first:
[{"kind":"offer|cfp|event|report|post","title":"...","detail":"...","deadline":"YYYY-MM-DD or empty","url":"..."}]

Kinds:
- offer: a discount, sale, promo code, free course or scholarship. Put the code, the percentage or the price in "detail" exactly as the page states it.
- cfp: a call for papers, talks, proposals or sponsors with a deadline.
- event: an upcoming event or webinar to register for.
- report: a free report, survey result or other download.
- post: a recent blog post or announcement worth a line in the newsletter.

Rules:
- Use ONLY what the page states. Never invent a code, price, percentage, date or link.
- "url" must be an href that appears in the page's HTML, copied exactly. Skip an item with no link of its own.
- "deadline" is the closing, end or event date the page states for that item, as YYYY-MM-DD; leave it empty when the page states none. Skip items whose date is before the issue's send date given above.
- "detail" is one short line, under 200 characters.
- Skip navigation, footer, social and cookie links.`;

/**
 * How long the BFF waits for a HubSpot template search, filtered or scoped.
 *
 * Above campaign-service's own 40s search deadline (`emailSearchCallTimeout`), so the service
 * answers -- with a typed 503 if its walk overran -- before this side gives up. A filtered walk
 * reads up to 20 pages sequentially and measured 15-16s against the LF portal.
 */
export const HUBSPOT_EMAIL_SEARCH_TIMEOUT_MS = 45_000;
