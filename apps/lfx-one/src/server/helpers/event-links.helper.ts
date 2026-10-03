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
 *
 * Scanned with `indexOf` rather than `/<!--[\s\S]*?-->/g` and friends. A lazy `[\s\S]*?` runs to
 * the end of the input for every opener that has no closer, so an opener repeated k times costs
 * O(n^2): measured on `'<!--'.repeat(k)`, 20k chars took 19ms, 40k 75ms, 80k 297ms and 160k
 * 1250ms -- a clean 4x per doubling, and the fetch cap is 5 MiB. `extractPageLinks` runs this
 * synchronously on an operator-supplied URL's body, so one hostile page stalls every other
 * request on the single-threaded SSR process. Same class as the `ANCHOR_TAG_RE` bound above.
 * Each opener is found at most once across the whole pass -- which takes BOTH the `indexOf` scan
 * and the opener cache in `withoutInertRegions`. The scan alone was still quadratic on CLOSED
 * regions (measured at 365ms / 1442ms / 5741ms over 70k / 140k / 280k of `'<!---->'`), because
 * re-searching every kind from the cursor made a kind with no remaining opener scan to the end
 * of the input on each region. Both halves are needed; neither is linear by itself.
 *
 * An opener with NO closer blanks to the end of the input, which is what a browser renders: an
 * unterminated `<!--` or `<script>` swallows the rest of the document. Stopping at the opener
 * instead left every later anchor in the map, so one trailing `<!--` was enough to make
 * `verifyPageLink` vouch for destinations the page never shows.
 */
function withoutInertRegions(html: string): string {
  // ASCII-only, NOT `toLowerCase()`. `toLowerCase()` lower-cases the whole document, and some
  // characters CHANGE LENGTH doing so -- `İ` (U+0130) becomes two code units -- which shifted every
  // later offset relative to `html`. `İİİİİ<script>x</script><a href="...">` lost the real link,
  // and an attacker-controlled prefix could shift a blank region off its script onto live markup.
  // LF runs İstanbul events, so this was live rather than theoretical. A tag name is ASCII, so
  // folding only `A-Z` is enough to match one and is guaranteed length-preserving.
  const lower = asciiLower(html);
  // Each kind's next opener, carried ACROSS iterations. Re-searching all three from `at` every
  // time made a document of k CLOSED regions O(n*k): a kind with no remaining opener scanned to
  // the end of the input on every one. Measured before this: 70k chars 365ms, 140k 1442ms, 280k
  // 5741ms -- the same 4x per doubling as the lazy regex it replaced, just on a different input.
  // A -1 stays -1 for the rest of the pass, and any other index is only re-searched once `at`
  // passes it, so every opener is found at most once across the whole scan.
  const next = INERT_REGIONS.map((kind) => openerIndex(lower, kind, 0));
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const region = nextInertRegion(html, lower, at, next);
    if (region === null) {
      out.push(html.slice(at));
      return out.join('');
    }
    out.push(html.slice(at, region.start), ' '.repeat(region.end - region.start));
    at = region.end;
  }
}

/**
 * `html` with `A-Z` folded to lower case and every other character untouched.
 *
 * Length-preserving by construction, which is the whole point: the offsets found in the result
 * index the same characters in the original. See `withoutInertRegions` for what went wrong when
 * this was `toLowerCase()`.
 */
function asciiLower(html: string): string {
  return html.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/**
 * Whether a matched tag-name prefix actually ENDS at `at` -- the `\b` the old regex carried.
 *
 * `<script>` and `<script src=x>` open an element; `<scriptfoo>` does not, and treating it as one
 * blanked to the end of the document. A tag name ends at `>`, `/`, or whitespace.
 */
function opensAnElement(lower: string, at: number): boolean {
  const next = lower[at];
  return next === undefined || next === '>' || next === '/' || /\s/.test(next);
}

/** Every region kind, with the closer that ends it and how that closer is spelled. */
const INERT_REGIONS: readonly {
  readonly opener: string;
  readonly closer: string;
  readonly isTagName: boolean;
  readonly closerNeedsGt: boolean;
}[] = [
  // `<!--` is not a tag name, so no name boundary follows it: `<!--<a href=...` opens a comment.
  // Its closer is COMPLETE as written -- `-->` already carries its own `>`.
  { opener: '<!--', closer: '-->', isTagName: false, closerNeedsGt: false },
  // These closers stop at the tag NAME, so the region ends at the first `>` after it.
  { opener: '<script', closer: '</script', isTagName: true, closerNeedsGt: true },
  { opener: '<style', closer: '</style', isTagName: true, closerNeedsGt: true },
];

/**
 * The first inert region at or after `from`, or `null` when none remains.
 *
 * The opener search is case-insensitive because `<SCRIPT>` is the same element, and so is the
 * closer search: `</Script >` ends it. `indexOf` is case-SENSITIVE, so both sides work on a
 * lower-cased copy and index back into the original -- lower-casing cannot change the length of
 * an ASCII tag name, so the offsets stay aligned with `html`.
 *
 * The closer is matched WITHOUT its `>`, so `</script foo>` and `</script\n>` both close. A
 * browser ends the element at the tag name; requiring the exact `>` meant `</script >` did not
 * close and the rest of the document stayed live.
 *
 * A tag-name opener only counts when the NAME ends there -- see `opensAnElement`. A bare `indexOf`
 * prefix matched `<scriptfoo>`, which is an unknown element a browser renders normally, and blanked
 * the rest of the document: every real link on a page containing that string disappeared. `<!--`
 * carries `isTagName: false` and is exempt, because it is not a tag name and `<!--<a href=...` is
 * a comment; applying the check to it left unterminated comments entirely unblanked.
 */
function nextInertRegion(html: string, lower: string, from: number, next: number[]): { start: number; end: number } | null {
  // The EARLIEST opener is chosen first, and only then is its own closer looked up. Taking the
  // closer from whichever kind was examined last instead let a later kind overwrite the winner,
  // so a `<script>` body between a comment and a `<style>` survived the pass entirely.
  let winner: { start: number; kind: (typeof INERT_REGIONS)[number] } | null = null;
  for (const [i, kind] of INERT_REGIONS.entries()) {
    // Re-searched only when the cached hit now lies BEHIND the cursor. -1 is terminal: a kind with
    // no opener left never has one again, so it is never searched for a second time.
    if (next[i] !== -1 && (next[i] as number) < from) {
      next[i] = openerIndex(lower, kind, from);
    }
    const start = next[i] as number;
    if (start !== -1 && (winner === null || start < winner.start)) {
      winner = { start, kind };
    }
  }
  if (winner === null) {
    return null;
  }
  const { start, kind } = winner;
  const closeAt = lower.indexOf(kind.closer, start + kind.opener.length);
  if (closeAt === -1) {
    // No closer: the region runs to the end of the document, exactly as a browser treats it.
    return { start, end: html.length };
  }
  const afterCloser = closeAt + kind.closer.length;
  if (!kind.closerNeedsGt) {
    return { start, end: afterCloser };
  }
  // `</script` stops at the tag name, so the region ends at the first `>` after it -- that is what
  // lets `</script >` close. Searching for a `>` after a closer that ALREADY ends in one (`-->`)
  // ran on past it and swallowed the next tag's `>`: `<!--x--><script>` had the script's own
  // opening tag consumed by the comment, so the script body was never recognised as inert.
  const gt = html.indexOf('>', afterCloser);
  return { start, end: gt === -1 ? html.length : gt + 1 };
}

/** The first real opener of this kind at or after `from`, skipping tag-name prefix matches. */
function openerIndex(lower: string, kind: (typeof INERT_REGIONS)[number], from: number): number {
  let at = from;
  for (;;) {
    at = lower.indexOf(kind.opener, at);
    if (at === -1 || !kind.isTagName || opensAnElement(lower, at + kind.opener.length)) {
      return at;
    }
    at += kind.opener.length;
  }
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
 * What it does NOT check is the HOST. Any absolute http(s) anchor the page carries passes,
 * including off-site sponsor, social and third-party links, so a hostile page can still steer
 * WHICH of its real links a model labels `agenda_url`. That is deliberate: events legitimately
 * drive agendas and registration from Sched, Cvent, CFP platforms, the registration domain and
 * each foundation's own site, and an allowlist of those hosts is long, moving, and rejects a REAL
 * event link for every entry it is missing -- the same failure as accepting a forged one, just
 * quieter. A host rule would also only narrow the threat, never close it: a decoy can be hosted on
 * an allowlisted domain. So the claim here is deliberately the narrow one -- THE PAGE LINKS TO
 * THIS -- which holds regardless of host; mis-selection among links the page really carries is a
 * known accepted risk, not something this defends against.
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
