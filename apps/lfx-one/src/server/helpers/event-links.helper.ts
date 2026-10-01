// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

const ANCHOR_HREF_RE = /<a\b[^>]*\bhref=["']([^"']+)["']/gi;

/**
 * Upper bound on distinct links collected from one page.
 *
 * `fetchSafeUrl` caps a download at 5 MiB, which is enough HTML for tens of thousands of anchors.
 * The verification below only ever looks up a handful of candidates, so an exhaustive set buys
 * nothing past the point where a real event page has been covered.
 */
const MAX_PAGE_LINKS = 5000;

/**
 * A comparable form of a URL, or `null` when it is not an absolute http(s) URL.
 *
 * Both sides of the verification are reduced through this, because the extraction model and the
 * page's own markup routinely write the same destination differently: a trailing slash, an
 * upper-case host, a `#section` suffix. Comparing raw strings rejected links the page really did
 * publish, which defeats the purpose — the check is meant to catch INVENTED URLs, not formatting.
 *
 * The query string is KEPT. `?utm_source=…` and `?year=2026` are not interchangeable, and a page
 * that links to one of them has not linked to the other.
 */
function normalizeForCompare(candidate: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(candidate, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    resolved.hash = '';
    const path = resolved.pathname.length > 1 ? resolved.pathname.replace(/\/$/, '') : resolved.pathname;
    return `${resolved.protocol}//${resolved.host.toLowerCase()}${path}${resolved.search}`;
  } catch {
    return null;
  }
}

/**
 * Every absolute http(s) destination the page's own anchors point at, in comparable form.
 *
 * Best-effort and never throws, mirroring `extractHeroAndSponsors`: a page this cannot parse
 * yields an empty set, which makes every candidate link fail verification and be dropped. That is
 * the safe direction — a brief with no agenda link is correct, a brief with a wrong one is not.
 */
export function extractPageLinks(html: string, baseUrl: string): Set<string> {
  const links = new Set<string>();
  try {
    for (const match of html.matchAll(ANCHOR_HREF_RE)) {
      if (links.size >= MAX_PAGE_LINKS) break;
      const normalized = normalizeForCompare(match[1], baseUrl);
      if (normalized) links.add(normalized);
    }
  } catch {
    return new Set<string>();
  }
  return links;
}

/**
 * `candidate` resolved against the page, but ONLY if the page actually links to it.
 *
 * The extraction that produces these candidates is an LLM reading page prose, and a model asked
 * for "the agenda URL" will happily compose a plausible one — `/schedule/`, `/agenda-2026/` —
 * from the site's URL shape when the page states none. The result is not an empty field but a
 * confident wrong one, and these URLs are printed as hyperlinks into a marketing email sent under
 * a real foundation's name. So a candidate is a HINT about which of the page's real links matters,
 * never itself a source of truth.
 *
 * `registrationUrl` is deliberately NOT routed through this. It predates the check, it is the
 * primary call-to-action's href, and event pages commonly drive registration from a scripted
 * button rather than an `<a href>` — so verifying it would strip working CTAs from existing
 * campaigns. That is a known gap, not an oversight.
 */
export function verifyPageLink(candidate: unknown, pageLinks: Set<string>, baseUrl: string): string {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return '';
  }
  const normalized = normalizeForCompare(candidate, baseUrl);
  if (!normalized || !pageLinks.has(normalized)) {
    return '';
  }
  return normalized;
}
