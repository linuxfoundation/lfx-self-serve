// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Opening `<a>` tags, bounded so the scan cannot backtrack.
 *
 * `[^<>]*`, never `[^>]*`. An unbounded `[^>]*` lets each `<a` scan to the end of the document
 * before failing, so a page of repeated `<a ` is QUADRATIC: measured 115ms at 20k tags, 454ms at
 * 40k, 8.5s at 80k, against a 5 MiB fetch cap. `matchAll` is synchronous and this runs inside the
 * scrape generator on an operator-supplied URL, so that is a freeze of the single-threaded SSR
 * process. Excluding `<` as well confines each attempt to one tag.
 */
const ANCHOR_TAG_RE = /<a\b[^<>]*>/gi;

/**
 * `html` with the regions a browser never renders as markup blanked out.
 *
 * Scanning the raw source treated an anchor inside a COMMENT or a `<script>`/`<style>` body as a
 * real link, so `<!-- <a href="https://evil.example/fake">x</a> -->` entered the map and
 * `verifyPageLink` then vouched for a destination the page does not link to at all. A page author
 * -- or a model reading the same source -- can put anything there.
 *
 * Blanked to SPACES rather than removed, so every surviving tag keeps its original offset and the
 * `MAX_PAGE_LINKS` bound still measures the same document.
 */
function withoutInertRegions(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, (match) => ' '.repeat(match.length))
    .replace(/<script\b[^<>]*>[\s\S]*?<\/script\s*>/gi, (match) => ' '.repeat(match.length))
    .replace(/<style\b[^<>]*>[\s\S]*?<\/style\s*>/gi, (match) => ' '.repeat(match.length));
}

/**
 * One attribute inside an already-isolated tag: its name, and its quoted value.
 *
 * Walked attribute by attribute rather than searched for `href=` directly. A regex that scans
 * the tag for `href=` finds it inside ANOTHER attribute's value, because the quotes around that
 * value are just characters to it:
 *
 *   <a title=" href='https://evil.example/agenda'" href="/real">
 *
 * picked `https://evil.example/agenda` -- and `verifyPageLink` would then vouch for a URL the
 * page never links to, carrying it into the brief as the event's agenda. Consuming the value as
 * a unit is what makes the quotes structural instead of incidental.
 *
 * `\s` before the name, not `\b`: `\b` also matches the tail of `data-href`, so a framework's
 * lazy-load attribute was read as the link the page renders.
 */
const ATTR_RE = /\s([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

/**
 * HTML entities for `&` as they appear in an href.
 *
 * A page writes `?a=1&amp;b=2`; `new URL` keeps that literal, so the stored link carried `&amp;`
 * while the extraction model returned the decoded `&`. The two then failed to compare equal and a
 * real agenda link with more than one query parameter was silently dropped.
 */
const AMP_ENTITY_RE = /&(?:amp|#38|#[xX]26);/g;

/**
 * Upper bound on distinct links collected from one page.
 *
 * `fetchSafeUrl` caps a download at 5 MiB, which is enough HTML for tens of thousands of anchors.
 * The verification below only ever looks up a handful of candidates, so an exhaustive set buys
 * nothing past the point where a real event page has been covered.
 */
const MAX_PAGE_LINKS = 5000;

/**
 * The `href` an opening tag actually declares, or `''` when it declares none.
 *
 * The FIRST `href`, matching how a browser resolves a duplicate attribute: everything after the
 * first is ignored, so a page cannot show one link and have this read another.
 */
function hrefOf(tag: string): string {
  ATTR_RE.lastIndex = 0;
  for (let attr = ATTR_RE.exec(tag); attr !== null; attr = ATTR_RE.exec(tag)) {
    if (attr[1].toLowerCase() === 'href') {
      // Three alternations: double-quoted, single-quoted, and UNQUOTED. HTML permits
      // `href=/agenda` with no quotes, and a pattern that required them dropped a real event
      // link -- rejecting the page's own destination is the same failure as accepting a forged
      // one, just quieter.
      const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
      return value.replace(AMP_ENTITY_RE, '&');
    }
  }
  return '';
}

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
 *
 * This form is a LOOKUP KEY ONLY and is never emitted. Its two lossy steps — dropping the
 * fragment and the trailing slash — are what make matching tolerant, and they are exactly what
 * must not reach a recipient: `/program#day-2` would arrive as a link to the page top, and
 * `/agenda/` as `/agenda`, which 404s on a static host that only has `/agenda/index.html`.
 * `pageHref` below builds what is actually sent.
 */
function normalizeForCompare(candidate: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(candidate, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    // The FRAGMENT is kept, because on a single-page event site it is the whole destination.
    // Dropping it merged `#agenda` and `#cfp` into one key, so the map held only whichever came
    // first and `verifyPageLink('…#cfp')` returned the AGENDA link -- a generated email sending
    // readers to the wrong section of a page the model had quoted exactly.
    const hash = resolved.hash;
    resolved.hash = '';
    const path = resolved.pathname.length > 1 ? resolved.pathname.replace(/\/$/, '') : resolved.pathname;
    return `${resolved.protocol}//${resolved.host.toLowerCase()}${path}${resolved.search}${hash}`;
  } catch {
    return null;
  }
}

/**
 * The page's own destination, in the form a recipient should be sent to.
 *
 * Reassembled from the parsed `URL` rather than returned as the raw href, so the guarantees
 * `normalizeForCompare` provides still hold on the emitted value: the scheme has been checked, a
 * relative href is resolved against the page, and `userinfo` — the `https://evil.example@host/x`
 * shape — is discarded because it is simply not one of the parts read back out. Path, query and
 * fragment are preserved verbatim; only the host is lower-cased, which hosts are anyway.
 */
function pageHref(resolved: URL): string {
  return `${resolved.protocol}//${resolved.host.toLowerCase()}${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/**
 * Every absolute http(s) destination the page's own anchors point at: comparison key -> real href.
 *
 * A map rather than a set because the two forms differ and both are needed — the key makes
 * matching tolerant of how a model rewrites a URL, the value is what the page actually published
 * and therefore what may be emailed. The FIRST href to claim a key wins, so when a page links
 * both `/agenda` and `/agenda/` the one it published earlier is the one used, in document order.
 *
 * Best-effort and never throws, mirroring `extractHeroAndSponsors`: a page this cannot parse
 * yields an empty map, which makes every candidate link fail verification and be dropped. That is
 * the safe direction — a brief with no agenda link is correct, a brief with a wrong one is not.
 */
export function extractPageLinks(html: string, baseUrl: string): Map<string, string> {
  const links = new Map<string, string>();
  try {
    for (const tag of withoutInertRegions(html).matchAll(ANCHOR_TAG_RE)) {
      if (links.size >= MAX_PAGE_LINKS) break;
      const raw = hrefOf(tag[0]);
      if (raw === '') continue;
      const normalized = normalizeForCompare(raw, baseUrl);
      if (!normalized || links.has(normalized)) continue;
      links.set(normalized, pageHref(new URL(raw, baseUrl)));
    }
  } catch {
    return new Map<string, string>();
  }
  return links;
}

/**
 * The page's own href for `candidate`, or `''` when the page does not link to it.
 *
 * What comes back is the PAGE's URL, not the candidate's — they agree only up to
 * `normalizeForCompare`, and the difference is the point. A model that writes `/agenda` for a
 * page that published `/agenda/`, or that drops `#day-2` from `/program#day-2`, has named the
 * right link in the wrong form; returning the page's form sends the recipient where the page
 * sends its own readers. The candidate's spelling is never emitted.
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
export function verifyPageLink(candidate: unknown, pageLinks: Map<string, string>, baseUrl: string): string {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return '';
  }
  const normalized = normalizeForCompare(candidate, baseUrl);
  if (!normalized) {
    return '';
  }
  const exact = pageLinks.get(normalized);
  if (exact !== undefined) {
    return exact;
  }

  // Fragment-less fallback, allowed ONLY when it is unambiguous.
  //
  // Keys carry their fragment, so a model that wrote `/agenda` for a page whose only link is
  // `/agenda#schedule` would otherwise fail verification on a link the page really does render.
  // But if the page links to `/agenda#day1` AND `/agenda#day2`, there is no single destination
  // `/agenda` means -- picking one would send readers to a section nobody chose, which is the
  // defect this fallback must not reintroduce. Ambiguity therefore refuses.
  if (normalized.includes('#')) {
    return '';
  }
  const prefix = `${normalized}#`;
  let onlyMatch = '';
  for (const [key, href] of pageLinks) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    if (onlyMatch !== '') {
      return '';
    }
    onlyMatch = href;
  }
  return onlyMatch;
}
