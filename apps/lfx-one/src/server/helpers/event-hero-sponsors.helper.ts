// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignEventSponsor } from '@lfx-one/shared/interfaces';
import { MAX_SPONSORS } from '@lfx-one/shared/constants';
// Deep path, NOT the `@lfx-one/shared/utils` barrel, and deliberately so: the barrel
// re-exports `form.utils`, which imports `@angular/forms`. A server spec that pulls the
// barrel in dies with "PlatformLocation needs to be compiled using the JIT compiler".
// Verified by switching to the barrel and watching the suite fail.
import { canonicalHttpUrl } from '@lfx-one/shared/utils/url.utils';

const SPONSOR_KEYWORD_RE = /sponsor|partner|supporter|exhibitor/i;
const CONTEXT_WINDOW_CHARS = 400;

/**
 * HTML entities that can legally appear inside an attribute value.
 *
 * Only these five are needed: an attribute is delimited by its quote character, so the entities
 * a serializer is obliged to escape there are `&`, `<`, `>` and whichever quote is in use. The
 * numeric forms are handled too because serializers emit them interchangeably.
 */
function decodeHtmlEntities(value: string): string {
  return (
    value
      .replace(/&(?:#0*60|#[xX]0*3[cC]|lt);/g, '<')
      .replace(/&(?:#0*62|#[xX]0*3[eE]|gt);/g, '>')
      .replace(/&(?:#0*34|#[xX]0*22|quot);/g, '"')
      .replace(/&(?:#0*39|#[xX]0*27|apos|#0*39);/g, "'")
      // `&amp;` LAST, so `&amp;lt;` decodes to the literal text `&lt;` rather than to `<` --
      // decoding it first would let one escaped entity become a different real one.
      .replace(/&(?:#0*38|#[xX]0*26|amp);/g, '&')
  );
}

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

function extractHeroImage(html: string, baseUrl: string): string {
  const metaMatch =
    html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);
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

function extractSponsors(html: string, baseUrl: string, heroImageUrl: string): CampaignEventSponsor[] {
  const sponsors: CampaignEventSponsor[] = [];
  const seen = new Set<string>();
  if (heroImageUrl) seen.add(heroImageUrl);

  for (const imgMatch of html.matchAll(/<img\b[^>]*>/gi)) {
    if (sponsors.length >= MAX_SPONSORS) break;

    const tag = imgMatch[0];
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src) continue;

    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1]?.trim() ?? '';
    // A page rarely marks sponsor logos with a dedicated attribute, so a nearby heading or
    // container class (e.g. "Our Sponsors", class="sponsor-grid") is the most reliable signal.
    const contextStart = Math.max(0, (imgMatch.index ?? 0) - CONTEXT_WINDOW_CHARS);
    const context = html.slice(contextStart, imgMatch.index ?? 0);
    const looksLikeSponsor = SPONSOR_KEYWORD_RE.test(alt) || SPONSOR_KEYWORD_RE.test(src) || SPONSOR_KEYWORD_RE.test(context);
    if (!looksLikeSponsor) continue;

    const resolved = resolveUrl(src, baseUrl);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);

    const fallbackName = (resolved.split('/').pop() ?? 'Sponsor').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
    sponsors.push({ name: alt || fallbackName, logoUrl: resolved });
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
