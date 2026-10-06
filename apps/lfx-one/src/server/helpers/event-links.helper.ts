// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { decodeHtmlEntities } from '@lfx-one/shared/utils/html-utils';
import { Tokenizer } from 'htmlparser2';

import { MAX_PAGE_LINKS, RAW_TEXT_CLOSER_SOLIDUS_RE, RAW_TEXT_CONTAINERS, TOKENIZER_RAW_TEXT_ELEMENTS } from '../constants/audience-builder.constants';

/**
 * The FIRST `href` of every `<a>` a browser renders as a link, in document order, plus the first
 * HTML `<base href>`.
 *
 * What this protects against is a model INVENTING a URL, not a page planting one: the page is the
 * authority on its own links, and its owner can publish any real link they like. So the rule is to
 * fail SAFE -- where this tokenizer and a browser disagree, a real link may be dropped, but an
 * inert one should not be accepted. Exotic spec corners that only ever drop a link (a raw-text
 * closer hidden inside a comment, `--!>` comment endings, script double-escaping) are left as
 * documented gaps rather than chased one decoy at a time.
 *
 * Built on htmlparser2's TOKENIZER, which implements the tokenizing rules a hand-rolled scanner
 * kept being defeated on -- an `href` inside another attribute's value, anchor markup inside an
 * attribute, bogus comments (`<!x …>`, `<? …>`), U+00A0 read as tag-name whitespace, entities
 * beyond `&amp;`. NOT on a tree builder: parse5's and htmlparser2's `Parser` keep an open-element
 * stack that hostile markup makes quadratic (400 KB of unclosed `<div>` took 20 s in parse5)
 * against a 5 MiB fetch cap on a synchronous, single-threaded SSR path. Flat counters stand in for
 * the stack, so the pass is one linear walk.
 *
 * - The `/` on a non-void HTML start tag is IGNORED, as the spec ignores it: `<textarea/>` still
 *   opens a textarea. The tokenizer leaves raw-text mode on a self-closing tag, so those elements
 *   are counted here instead -- their content may then be read as markup, but anything found inside
 *   is discarded.
 * - Raw-text containers do not nest (`<iframe><iframe></iframe>` closes at the first closer), so
 *   they are flags, not counts. `<template>` does nest; a declarative shadow root
 *   (`<template shadowrootmode>`) is RENDERED and is not inert.
 * - MathML is not treated as inert: an unclosed or broken-out `<math>` would otherwise drop every
 *   later link on the page, which is the costlier failure.
 * - Inside `<svg>` the self-closing slash is real and `<base>` is not an HTML base. Attribute names
 *   match exactly, so `href` is read and `xlink:href` is not (when both exist, SVG2 follows `href`;
 *   an anchor carrying ONLY `xlink:href` is dropped, the safe direction).
 */
function scanDocument(html: string): { hrefs: string[]; baseHref: string | null } {
  const hrefs: string[] = [];
  let baseHref: string | null = null;
  const rawText = new Set<string>();
  let templateDepth = 0;
  let svgDepth = 0;
  let plaintext = false;
  let tag = '';
  let attrName = '';
  let attrValue = '';
  let href: string | null = null;
  let shadowRoot = false;

  const isInert = (): boolean => plaintext || rawText.size > 0 || templateDepth > 0;

  const finishOpenTag = (selfClosingSyntax: boolean): void => {
    // The `/` only means something in foreign content; on an HTML element it is ignored.
    const selfClosing = selfClosingSyntax && svgDepth > 0;
    if (href !== null && !isInert()) {
      if (tag === 'a') {
        hrefs.push(href);
      } else if (tag === 'base' && baseHref === null && svgDepth === 0) {
        baseHref = href;
      }
    }
    if (selfClosing || isInert()) {
      // Nothing inside an inert region opens anything that matters; only its own closer does.
      if (!selfClosing && tag === 'template' && templateDepth > 0 && !shadowRoot) {
        templateDepth++;
      }
      return;
    }
    if (tag === 'plaintext') {
      plaintext = true;
    } else if (tag === 'svg') {
      svgDepth++;
    } else if (tag === 'template') {
      if (!shadowRoot) {
        templateDepth++;
      }
    } else if (RAW_TEXT_CONTAINERS.has(tag) || (selfClosingSyntax && TOKENIZER_RAW_TEXT_ELEMENTS.has(tag))) {
      // The second arm: a self-closed `<script/>` knocked the tokenizer out of raw-text mode, so
      // its content is about to be tokenized as markup. Count it, and discard what is found.
      rawText.add(tag);
    }
  };

  const tokenizer = new Tokenizer(
    { xmlMode: false, decodeEntities: true },
    {
      onopentagname(start, end) {
        tag = html.slice(start, end).toLowerCase();
        href = null;
        shadowRoot = false;
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
        } else if (attrName === 'shadowrootmode' && tag === 'template') {
          shadowRoot = true;
        }
      },
      onopentagend() {
        finishOpenTag(false);
      },
      onselfclosingtag() {
        finishOpenTag(true);
      },
      onclosetag(start, end) {
        // A closer written with a slash (`</iframe/>`) was normalised before tokenizing; see
        // `RAW_TEXT_CLOSER_SOLIDUS_RE`.
        const name = html.slice(start, end).toLowerCase();
        if (rawText.has(name)) {
          rawText.delete(name);
        } else if (name === 'template' && templateDepth > 0 && rawText.size === 0) {
          templateDepth--;
        } else if (name === 'svg' && svgDepth > 0 && !isInert()) {
          svgDepth--;
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
  // `\/` unescaped too: JSON-LD `offers.url` is commonly written with escaped slashes (PHP and
  // WordPress `json_encode` default), and copied verbatim it became `https://host//register`.
  const value = decodeHtmlEntities(candidate.trim()).replace(/\\\//g, '/');
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
