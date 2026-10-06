// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// Audience Builder — Server-Only Constants
// ---------------------------------------------------------------------------
//
// Server-only, like `reddit.constants.ts` beside it. These tune a scrape and a proxy call that
// run exclusively in the BFF; none is part of the UI contract, so putting them in
// `@lfx-one/shared` would publish server internals into the browser bundle with no consumer.

/**
 * The ceiling for an audience-builder call that reads CONFIGURATION rather than walking a portal.
 *
 * A hung upstream otherwise holds a socket and a request for the full two-minute ceiling on a call
 * that cannot legitimately take that long, and the page fires several reads at once.
 *
 * Only `capabilities` qualifies today -- it answers a single boolean about whether a connection
 * row exists. Everything else walks the HubSpot Marketing API, and `last-sent` is the cautionary
 * case: it reads as a cheap list read and was measured at 32s at the limit the panel asks for and
 * 58s at the design's, against the live TLF portal.
 */
export const AUDIENCE_CAPABILITIES_TIMEOUT_MS = 30_000;

/**
 * Upper bound on distinct links collected from one page.
 *
 * `fetchSafeUrl` caps a download at 5 MiB, which is enough HTML for tens of thousands of anchors.
 * The verification below only ever looks up a handful of candidates, so an exhaustive set buys
 * nothing past the point where a real event page has been covered.
 */
export const MAX_PAGE_LINKS = 5000;

/**
 * Elements whose content a browser never renders as live markup, and which htmlparser2's tokenizer
 * does NOT put into raw-text mode itself -- so `scanDocument` tracks them. `noscript` is raw text
 * in a scripting browser. Flags, not counts: raw text does not nest.
 */
export const RAW_TEXT_CONTAINERS: ReadonlySet<string> = new Set(['noscript', 'iframe', 'noembed', 'noframes']);

/**
 * Elements the tokenizer DOES put into raw-text mode -- until a self-closing slash knocks it out.
 * `<textarea/>` still opens a textarea in a browser, so `scanDocument` counts these when self-closed.
 */
export const TOKENIZER_RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set(['script', 'style', 'title', 'textarea', 'xmp']);

/**
 * A raw-text or inert-container closer followed by `/` -- `</script/>`, `</iframe/>`.
 *
 * A browser ends raw text at the closer's name followed by whitespace, `/` or `>`; the tokenizer
 * accepts only the first and last, so `</script/>` left the rest of the document as script text.
 * Replaced with a space, which the spec treats identically there and which keeps every offset --
 * the tokenizer callbacks slice the input by index.
 */
export const RAW_TEXT_CLOSER_SOLIDUS_RE = /<\/(script|style|title|textarea|xmp|noscript|iframe|noembed|noframes|template)\//gi;
