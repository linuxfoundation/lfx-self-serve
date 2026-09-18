// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignEventSponsor } from '@lfx-one/shared/interfaces';

const SPONSOR_KEYWORD_RE = /sponsor|partner|supporter|exhibitor/i;
const MAX_SPONSORS = 10;
const CONTEXT_WINDOW_CHARS = 400;

/**
 * Whether a URL's host names a private, loopback, or link-local address.
 *
 * These values are scraped from an operator-named page, persisted on the brief, and forwarded to
 * campaign-service, which FETCHES the hero and re-hosts it as a publicly readable file. A
 * protocol-only check let `http://169.254.169.254/` through that path -- second-order SSRF, where
 * the request is issued by a service the page never talked to.
 *
 * The address is NORMALIZED before it is judged, because the same address has many spellings and
 * a pattern match on the raw host misses most of them: `[::ffff:169.254.169.254]` is the metadata
 * endpoint written in IPv6-mapped form, and matching text alone lets it straight through.
 * (`URL` already folds decimal and octal IPv4 into dotted-quad, so those arrive normalized.)
 *
 * It remains a DENYLIST, not proof of a public address: a hostname that RESOLVES to a private IP
 * still passes here, and campaign-service's dial-time guard -- which judges the resolved address
 * and closes the DNS-rebinding window -- stays the authoritative check. This stops the payload
 * from ever being persisted.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  // Strip IPv6 brackets, then fold an IPv4-mapped/compatible address back to its IPv4 form so
  // the one set of rules below judges every spelling.
  let addr = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  // `URL` rewrites an IPv4-mapped literal into hex groups -- `[::ffff:169.254.169.254]` arrives
  // as `[::ffff:a9fe:a9fe]` -- so the dotted-quad spelling never survives to be matched. Decode
  // the two hex groups back to IPv4 and judge that, or the metadata endpoint walks straight
  // through in the one form an attacker would actually reach for.
  const mappedHex = /^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    addr = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  } else if (/^(?:0*:)*(?:ffff:)?(?:\d{1,3}\.){3}\d{1,3}$/.test(addr)) {
    addr = addr.slice(addr.lastIndexOf(':') + 1);
  } else if (addr.includes(':')) {
    // A genuine IPv6 literal: ::1 loopback, fe80::/10 link-local, fc00::/7 unique-local.
    const groups = addr.split(':');
    const first = groups.find((g) => g !== '') ?? '';
    return addr === '::' || addr === '::1' || /^fe[89ab]/.test(first) || /^f[cd]/.test(first);
  }

  const octets = addr.split('.');
  if (octets.length !== 4) return false;
  const [a, b, c] = octets.map((o) => Number(o));
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) return false;

  if (a === 0 || a === 127) return true; // this-host, loopback
  if (a === 10) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 carrier-grade NAT
  return false;
}

function resolveUrl(candidate: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(candidate, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    if (isPrivateHost(resolved.hostname)) return null;
    return resolved.toString();
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
