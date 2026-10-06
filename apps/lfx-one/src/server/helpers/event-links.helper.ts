// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { decodeHtmlEntities } from '@lfx-one/shared/utils/html-utils';
import { Tokenizer } from 'htmlparser2';

import { MAX_PAGE_LINKS } from '../constants/audience-builder.constants';

/**
 * Elements whose content a browser never renders as live markup the operator could click.
 *
 * `script`, `style`, `title`, `textarea` and `xmp` need no entry: the tokenizer itself switches to
 * raw text for them, as the spec does. These are the rest. `template` content is an inert fragment
 * until script clones it; `noscript`, `iframe`, `noembed` and `noframes` are raw text in a
 * scripting browser; MathML `<a>` is not a hyperlink in Chromium. Counted rather than stacked, so
 * nesting costs nothing.
 */
const INERT_CONTAINERS = new Set(['template', 'noscript', 'iframe', 'noembed', 'noframes', 'math']);

/**
 * A raw-text closer followed by `/` -- `</script/>` -- which the tokenizer does not recognise.
 *
 * A browser ends script data at `</script` followed by whitespace, `/` or `>`; the tokenizer
 * accepts only the first and last, so `</script/>` left the rest of the document as script text
 * and every real link after it was dropped. The `/` is replaced with a space, which the spec treats
 * identically there and which keeps every offset -- the callbacks slice `html` by index.
 */
const RAW_TEXT_CLOSER_SOLIDUS_RE = /<\/(script|style|title|textarea|xmp)\//gi;

/**
 * The FIRST `href` of every `<a>` a browser renders as a link, in document order, plus the first
 * `<base href>`.
 *
 * Built on htmlparser2's TOKENIZER, and deliberately on nothing above it. A hand-rolled scanner
 * kept being defeated one decoy at a time -- an `href` inside another attribute's value, anchor
 * markup inside an attribute, anchors inside raw-text elements, bogus comments (`<!x …>`,
 * `<? …>`), U+00A0 read as tag-name whitespace, entities beyond `&amp;` -- because each fix
 * taught it one more tokenizing rule. The tokenizer implements those rules, so none of them is a
 * special case here.
 *
 * And not on a tree builder. parse5's and htmlparser2's `Parser` both keep an open-element stack
 * that hostile markup makes QUADRATIC: measured 400 KB of unclosed `<div>` at 20 s in parse5 and
 * 3 MB of `<b>` at 254 s in htmlparser2's Parser, against a 5 MiB fetch cap, on the synchronous
 * path of a single-threaded SSR process. Finding links needs no tree: a flat counter per inert
 * container is enough, so the whole pass is one linear walk of the input.
 *
 * Attribute names are matched EXACTLY, so an SVG `xlink:href` is not read as the `href` an SVG2
 * browser follows, and the first `href` wins as it does in a browser.
 */
function scanDocument(html: string): { hrefs: string[]; baseHref: string | null } {
  const hrefs: string[] = [];
  let baseHref: string | null = null;
  const inert = new Map<string, number>();
  let inertTotal = 0;
  let plaintext = false;
  let tag = '';
  let attrName = '';
  let attrValue = '';
  let href: string | null = null;

  const finishOpenTag = (selfClosing: boolean): void => {
    if (plaintext) {
      return;
    }
    if (href !== null && inertTotal === 0) {
      if (tag === 'a') {
        hrefs.push(href);
      } else if (tag === 'base' && baseHref === null) {
        baseHref = href;
      }
    }
    if (tag === 'plaintext') {
      // Everything after `<plaintext>` is text to the end of the document.
      plaintext = true;
    } else if (!selfClosing && INERT_CONTAINERS.has(tag)) {
      inert.set(tag, (inert.get(tag) ?? 0) + 1);
      inertTotal++;
    }
  };

  const tokenizer = new Tokenizer(
    { xmlMode: false, decodeEntities: true },
    {
      onopentagname(start, end) {
        tag = html.slice(start, end).toLowerCase();
        href = null;
      },
      onattribname(start, end) {
        attrName = html.slice(start, end).toLowerCase();
        attrValue = '';
      },
      onattribdata(start, end) {
        attrValue += html.slice(start, end);
      },
      onattribentity(codepoint) {
        attrValue += String.fromCodePoint(codepoint);
      },
      onattribend() {
        if (attrName === 'href' && href === null) {
          href = attrValue;
        }
      },
      onopentagend() {
        finishOpenTag(false);
      },
      onselfclosingtag() {
        finishOpenTag(true);
      },
      onclosetag(start, end) {
        const name = html.slice(start, end).toLowerCase();
        const open = inert.get(name) ?? 0;
        if (open > 0) {
          inert.set(name, open - 1);
          inertTotal--;
        }
      },
      oncdata() {},
      oncomment() {},
      ondeclaration() {},
      onend() {},
      onprocessinginstruction() {},
      ontext() {},
      ontextentity() {},
    }
  );
  tokenizer.write(html.replace(RAW_TEXT_CLOSER_SOLIDUS_RE, '</$1 '));
  tokenizer.end();
  return { hrefs, baseHref };
}

/**
 * The URL a page's relative links resolve against: its first `<base href>`, or `fallback`.
 *
 * A browser resolves relative anchors against the DOCUMENT base, not the URL that served the page.
 * Ignoring it on a sub-path deployment (`<base href="/kubecon-eu/">` served from `/kubecon-eu`)
 * turned a relative `agenda` into `/agenda` -- a 404 inside a sent email. Only an http(s) base is
 * honoured; anything else falls back.
 */
export function documentBaseUrl(html: string, fallback: string): string {
  try {
    return resolveBase(scanDocument(html).baseHref, fallback);
  } catch {
    return fallback;
  }
}

/** `baseHref` resolved against `fallback` when it is a usable http(s) base, else `fallback`. */
function resolveBase(baseHref: string | null, fallback: string): string {
  if (baseHref === null || baseHref.trim() === '') {
    return fallback;
  }
  try {
    const resolved = new URL(baseHref.trim(), fallback);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : fallback;
  } catch {
    return fallback;
  }
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
    const { hrefs, baseHref } = scanDocument(html);
    // Resolved against the DOCUMENT base, as a browser does; see `documentBaseUrl`.
    const base = resolveBase(baseHref, baseUrl);
    for (const raw of hrefs) {
      if (links.size >= MAX_PAGE_LINKS) break;
      if (raw.trim() === '') continue;
      const normalized = normalizeForCompare(raw, base);
      if (!normalized || links.has(normalized)) continue;
      links.set(normalized, pageHref(new URL(raw, base)));
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
 * campaigns. That is a known gap, not an oversight. A relative one is checked, by `resolveRegistrationUrl` below.
 */
export function verifyPageLink(candidate: unknown, pageLinks: Map<string, string>, baseUrl: string): string {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return '';
  }
  // Decoded like the page side is: the extraction prompt asks for the href AS WRITTEN, so a model
  // can return `?a=1&amp;b=2` for a link the parser read as `?a=1&b=2`, and the two never matched.
  const normalized = normalizeForCompare(decodeHtmlEntities(candidate.trim()), baseUrl);
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

/**
 * The registration link to emit: an absolute http(s) URL as given, or a RELATIVE one only when the
 * page's own anchors carry it; `''` otherwise.
 *
 * For `registrationUrl`, which skips `verifyPageLink` when absolute (see there) but has to reach the
 * brief as an absolute link: `coerceCampaignEventDetails` blanks anything relative, so a page
 * publishing `href="/register"` lost its registration destination.
 *
 * A relative candidate is VERIFIED rather than resolved blindly. Resolving every string against
 * the page turned unverified model output -- `TBD`, or anchor text such as `www.cvent.com/reg` --
 * into same-site URLs that passed coercion and shipped as the email's primary call to action. A
 * relative value can only have come from an href, so it is checkable against the page's anchors.
 *
 * Entities are decoded on both paths, as the parser does for the page's own hrefs: the extraction
 * prompt asks for the href as written, and a literal `&amp;` or `&#47;` breaks the URL.
 */
export function resolveRegistrationUrl(candidate: unknown, pageLinks: Map<string, string>, baseUrl: string): string {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return '';
  }
  const value = decodeHtmlEntities(candidate.trim());
  let absolute: URL | null = null;
  try {
    absolute = new URL(value);
  } catch {
    absolute = null;
  }
  if (absolute !== null) {
    return absolute.protocol === 'http:' || absolute.protocol === 'https:' ? pageHref(absolute) : '';
  }
  return verifyPageLink(value, pageLinks, baseUrl);
}
