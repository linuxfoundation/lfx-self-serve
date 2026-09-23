// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignEventSponsor } from '@lfx-one/shared/interfaces';
import { MAX_SPONSORS } from '@lfx-one/shared/constants';
// Deep path, NOT the `@lfx-one/shared/utils` barrel, and deliberately so: the barrel
// re-exports `form.utils`, which imports `@angular/forms`. A server spec that pulls the
// barrel in dies with "PlatformLocation needs to be compiled using the JIT compiler".
// Verified by switching to the barrel and watching the suite fail.
import { canonicalHttpUrl } from '@lfx-one/shared/utils/url.utils';
// The shared decoder rather than a local copy. It is SINGLE-PASS, so a decoded `&` cannot be
// re-read as the start of a fresh entity (`&amp;#39;` -> `&#39;` -> `'`) -- the double-unescape
// CodeQL flags -- and it covers every numeric form, not just a handful of named ones.
import { decodeHtmlEntities, sanitizeDisplayText } from '@lfx-one/shared/utils/html-utils';

const SPONSOR_KEYWORD_RE = /sponsor|partner|supporter|exhibitor/i;
const CONTEXT_WINDOW_CHARS = 400;

function resolveUrl(candidate: string, baseUrl: string): string | null {
  try {
    // Resolve against the page first -- scraped `src` values are routinely relative, which is the
    // one thing canonicalHttpUrl cannot do -- then hand the ABSOLUTE result to the same validator
    // the controller and the preview use. Restating the scheme/host rules here is what let this
    // copy drift: it returned `resolved.toString()`, keeping userinfo the others strip, so a
    // scraped credentialed image URL was persisted onto the brief.
    // DECODED first, and here rather than at each capture site: every scraped candidate reaches
    // this one function, so a new extractor cannot forget it. An attribute value in HTML source
    // is entity-encoded, so `?w=1200&amp;sig=abc` parsed raw yields a parameter literally named
    // `amp;sig` and NO `sig` -- a signed hero image then 403s, silently, as a missing image.
    const resolved = canonicalHttpUrl(new URL(decodeHtmlEntities(candidate), baseUrl).toString());
    return resolved === '' ? null : resolved;
  } catch {
    return null;
  }
}

/**
 * Every `<tagName ...>` open tag in the document, as raw tag text.
 *
 * WHY THIS EXISTS, rather than matching attributes against the whole page:
 * `/<meta[^>]+property=...[^>]*content=.../` has two unbounded `[^>]` runs that must BOTH match
 * before the engine can conclude failure. On input that never supplies the closing `>` -- which a
 * scraped page fully controls -- that backtracks quadratically. Measured on `'<meta '.repeat(n)`:
 * 16 KiB 18 ms, 32 KiB 71 ms, 64 KiB 277 ms, 128 KiB 1.1 s, 256 KiB 4.4 s -- a clean 4x per
 * doubling. `fetchSafeUrl` caps a response at 5 MiB (MAX_RESPONSE_BYTES), so the worst case this
 * helper could legitimately be handed is ~28 MINUTES of blocked event loop. SSR is single
 * threaded, so that is every user of the server, from one event URL.
 *
 * `[^<>]*` cannot pass a `<`, so each tag is scanned once and the scan is linear in page length.
 * Attribute patterns then run against ONE tag (a few hundred bytes), where backtracking is
 * bounded by the tag and cannot be grown by the attacker.
 */
function openTags(html: string, tagName: string): string[] {
  const tags: string[] = [];
  const re = new RegExp(`<${tagName}\\b[^<>]*>`, 'gi');
  for (const match of html.matchAll(re)) tags.push(match[0]);
  return tags;
}

function extractHeroImage(html: string, baseUrl: string): string {
  // Order is preserved, so the first tag carrying BOTH attributes wins, exactly as the previous
  // whole-page alternation did -- the attribute order within the tag no longer needs its own
  // pattern, which is what the second `html.match` was for.
  let metaCandidate = '';
  for (const tag of openTags(html, 'meta')) {
    if (!/property=["']og:image["']/i.test(tag)) continue;
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    if (content) {
      metaCandidate = content;
      break;
    }
  }
  const metaMatch = metaCandidate ? [metaCandidate, metaCandidate] : null;
  const metaImage = metaMatch?.[1] ? resolveUrl(metaMatch[1], baseUrl) : null;
  if (metaImage) return metaImage;

  // Fallback: an event page's own JSON-LD (schema.org Event) often carries a banner image
  // even when it has no og:image meta tag.
  for (const scriptMatch of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(scriptMatch[1].trim());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of candidates) {
        const type = entry?.['@type'];
        const isEvent = typeof type === 'string' ? /event/i.test(type) : Array.isArray(type) && type.some((t) => /event/i.test(String(t)));
        if (!isEvent) continue;

        const image = entry?.image;
        const imageUrl = Array.isArray(image) ? image[0] : image;
        if (typeof imageUrl === 'string') {
          const resolved = resolveUrl(imageUrl, baseUrl);
          if (resolved) return resolved;
        }
      }
    } catch {
      // Malformed JSON-LD on the page — skip it and keep scanning other script blocks.
    }
  }

  return '';
}

/**
 * Derives a display name from a logo URL, for a sponsor image with no usable `alt`.
 *
 * The PATHNAME only, never the whole URL. This name is forwarded as recipient-visible alt text
 * in the email, and a scraped `src` may be a signed URL -- `logo.png?X-Amz-Credential=AKIA...
 * &X-Amz-Signature=...` put an access key id and signature straight into the sponsor name, and
 * from there into everyone's inbox. Parsing also fixes a second, quieter bug: with the query
 * still attached, the extension strip below matched nothing, so the name kept its `.png` too.
 *
 * A URL that will not parse yields 'Sponsor' rather than a best-effort substring -- guessing at
 * the shape of a string that already defeated the parser is how the query ends up in the name
 * again.
 */
function sponsorFallbackName(resolved: string): string {
  let pathname: string;
  try {
    pathname = new URL(resolved).pathname;
  } catch {
    return 'Sponsor';
  }
  // Sanitized for the same reason the `alt` path is, and the percent-decode above is exactly
  // what makes it necessary: `%E2%80%AE` is a BIDI override, so a filename could carry the same
  // display spoof into the sponsor name that decoding an entity-encoded `alt` could. Decoding
  // without re-sanitizing trades one bug for another -- the mistake this file already documents
  // one line up, repeated here the moment a second decode was introduced.
  const base = pathname.split('/').pop() ?? '';
  const cleaned = sanitizeDisplayText(decodeSafely(base))
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return cleaned || 'Sponsor';
}

/** Decodes percent-escapes, falling back to the raw value when the input is malformed. */
function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractSponsors(html: string, baseUrl: string, heroImageUrl: string): CampaignEventSponsor[] {
  const sponsors: CampaignEventSponsor[] = [];
  const seen = new Set<string>();
  if (heroImageUrl) seen.add(heroImageUrl);

  for (const imgMatch of html.matchAll(/<img\b[^<>]*>/gi)) {
    if (sponsors.length >= MAX_SPONSORS) break;

    const tag = imgMatch[0];
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src) continue;

    // Decoded, then STRIPPED of anything that decoding could have resurrected. `alt` is captured
    // from the same entity-encoded attribute as the URL, so "Acme &amp; Co" shipped literally --
    // but decoding alone turns `&lt;script&gt;` back into live markup in a value that reaches a
    // sent email as an attribute. Decoding without re-sanitizing trades a cosmetic bug for an
    // injection one.
    const alt = sanitizeDisplayText(decodeHtmlEntities(tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? ''));
    // A page rarely marks sponsor logos with a dedicated attribute, so a nearby heading or
    // container class (e.g. "Our Sponsors", class="sponsor-grid") is the most reliable signal.
    const contextStart = Math.max(0, (imgMatch.index ?? 0) - CONTEXT_WINDOW_CHARS);
    const context = html.slice(contextStart, imgMatch.index ?? 0);
    const looksLikeSponsor = SPONSOR_KEYWORD_RE.test(alt) || SPONSOR_KEYWORD_RE.test(src) || SPONSOR_KEYWORD_RE.test(context);
    if (!looksLikeSponsor) continue;

    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);

    sponsors.push({ name: alt || sponsorFallbackName(resolved), logoUrl: resolved });
  }

  return sponsors;
}

/**
 * Extracts a hero/banner image and sponsor logos from an already-scraped event page's raw HTML.
 * Best-effort and never throws — a page with no matches simply yields an empty result, mirroring
 * the resilience of the rest of the brief-generation scrape pipeline.
 */
export function extractHeroAndSponsors(html: string, baseUrl: string): { heroImageUrl: string; sponsors: CampaignEventSponsor[] } {
  try {
    const heroImageUrl = extractHeroImage(html, baseUrl);
    const sponsors = extractSponsors(html, baseUrl, heroImageUrl);
    return { heroImageUrl, sponsors };
  } catch {
    return { heroImageUrl: '', sponsors: [] };
  }
}
