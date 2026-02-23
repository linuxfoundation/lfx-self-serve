// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isValidUrl, UrlMetadata } from '@lfx-one/shared';
import { Request } from 'express';

import { logger } from './logger.service';

/** Maximum bytes to read before aborting (enough to capture <head>) */
const MAX_READ_BYTES = 16_384;

/** Per-URL fetch timeout in milliseconds */
const FETCH_TIMEOUT_MS = 5_000;

/** Maximum number of URLs allowed per request */
export const MAX_URLS_PER_REQUEST = 10;

/** Maximum allowed redirect hops to prevent open-redirect SSRF */
const MAX_REDIRECTS = 3;

/** Hostnames and IP patterns that must never be fetched (SSRF protection) */
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local
  /^0\./, // 0.0.0.0 variants
  /^\[?::1]?$/, // IPv6 loopback
  /^\[?fe80:/i, // IPv6 link-local
  /^\[?fc00:/i, // IPv6 unique local
  /^\[?fd/i, // IPv6 unique local
  /\.internal$/i,
  /\.local$/i,
  /\.localhost$/i,
];

/** Returns true if the hostname resolves to a private/blocked address */
function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(h));
}

/** Regex to extract <title> content from HTML head */
const TITLE_REGEX = /<title[^>]*>([^<]+)<\/title>/i;

/** Common HTML entity map */
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

/** Decodes HTML entities and URI-encoded sequences in a title string */
function decodeTitle(raw: string): string {
  let title = raw.trim();

  // Decode named/numeric HTML entities
  title = title.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|[a-zA-Z]+);/g, (match, decimal, hex) => {
    if (decimal) return String.fromCharCode(parseInt(decimal, 10));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return HTML_ENTITIES[match] ?? match;
  });

  try {
    return decodeURIComponent(title);
  } catch {
    return title;
  }
}

/**
 * Fetches the page title for a single URL by streaming only the <head> portion.
 * Aborts the connection as soon as the title is found or </head> is reached.
 * Manually follows redirects to validate each hop against SSRF blocklists.
 */
async function fetchUrlTitle(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let currentUrl = url;

    // Manually follow redirects so we can validate each hop
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(currentUrl);
      if (isBlockedHostname(parsed.hostname)) {
        return null;
      }

      const response = await fetch(currentUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'LFX-One/1.0 (URL Metadata Fetcher)',
          Accept: 'text/html',
        },
        redirect: 'manual', // handle redirects ourselves
      });

      // Follow redirect — validate the target before continuing
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) return null;
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }

      if (!response.ok || !response.body) {
        return null;
      }

      // Skip non-HTML content (images, PDFs, binaries, etc.)
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return null;
      }

      return extractTitleFromStream(response.body, controller);
    }

    // Exceeded max redirects
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Reads a response body stream and extracts the <title> tag */
async function extractTitleFromStream(body: ReadableStream<Uint8Array>, controller: AbortController): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let bytesRead = 0;

  while (bytesRead < MAX_READ_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;

    bytesRead += value.length;
    accumulated += decoder.decode(value, { stream: true });

    const titleMatch = accumulated.match(TITLE_REGEX);
    if (titleMatch) {
      controller.abort();
      return decodeTitle(titleMatch[1]);
    }

    if (accumulated.toLowerCase().includes('</head>')) {
      controller.abort();
      return null;
    }
  }

  const titleMatch = accumulated.match(TITLE_REGEX);
  controller.abort();
  return titleMatch ? decodeTitle(titleMatch[1]) : null;
}

/**
 * Resolves metadata (title + domain) for an array of URLs.
 * Fetches are performed in parallel with individual timeouts.
 */
export async function resolveUrlMetadata(req: Request | undefined, urls: string[]): Promise<UrlMetadata[]> {
  logger.debug(req, 'resolve_url_metadata', 'Resolving metadata for URLs', { count: urls.length });

  const results = await Promise.all(
    urls.map(async (url): Promise<UrlMetadata> => {
      // Validate URL before fetching
      if (!isValidUrl(url)) {
        return { url, title: null, domain: extractDomain(url) };
      }

      const title = await fetchUrlTitle(url);
      return { url, title, domain: extractDomain(url) };
    })
  );

  logger.debug(req, 'resolve_url_metadata', 'Metadata resolution complete', {
    total: results.length,
    with_titles: results.filter((r) => r.title).length,
  });

  return results;
}

/** Extracts the domain from a URL, stripping the www prefix */
function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
