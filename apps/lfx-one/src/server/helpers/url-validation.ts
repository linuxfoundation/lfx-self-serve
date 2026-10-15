// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * URL and Cookie Validation Utilities
 *
 * This module provides secure validation functions for URLs and cookies to prevent
 * various security vulnerabilities including:
 * - Open redirect attacks
 * - Domain spoofing attacks
 * - Cookie injection attacks
 * - Cross-site scripting (XSS) via URL manipulation
 * - Unauthorized cookie acceptance from random domains
 *
 * Security Features:
 * - Strict domain allowlisting per environment
 * - Protocol validation (http/https only)
 * - Exact domain matching (no subdomain/parent domain matching)
 * - Suspicious character detection
 * - Cookie domain extraction and validation
 * - RFC 6265 cookie size compliance
 * - Specific Auth0 client ID validation
 * - Linux Foundation domain pattern validation
 *
 * @author Security Team
 * @version 2.0.0
 */

import { isPrivateHost, refuseUnfetchablePort } from '@lfx-one/shared/utils/url.utils';
import { ServiceValidationError } from '../errors';

/**
 * Escapes a value so it can only ever be one segment of an upstream URL path
 * @description Upstream paths are built by interpolating identifiers into a template string, and
 * `MicroserviceProxyService` concatenates the result onto the base URL without encoding anything.
 * A raw `../../something` is then normalized away by the URL parser and aims the request at a
 * different endpoint on the same service, still carrying the caller's credentials. Encoding is what
 * stops that: `/`, `?` and `#` become `%2F`, `%3F` and `%23`, so the value can no longer end the
 * segment, and what reaches upstream is one literal (unmatched) identifier that 404s.
 *
 * Encoding alone does not cover a segment that is *only* dots, which is why those are rejected
 * instead — see the guard below.
 *
 * Applied to every interpolated identifier, whatever its source. A body-supplied id is the obvious
 * case, but a path parameter is not safe either: Express percent-decodes `req.params`, so a `%2F` in
 * the request URL arrives as a real `/` in the value. The distinction is not worth tracking per call
 * site — an id that reaches this function is either already URL-safe, in which case encoding is a
 * no-op, or it is not, in which case encoding is exactly what was missing.
 *
 * A well-formed identifier — the UUIDs the meeting service issues — contains nothing
 * `encodeURIComponent` touches and is never dot-only, so this is a no-op on every legitimate value.
 * @param segment - The identifier to interpolate
 * @returns The percent-encoded segment
 * @throws {ServiceValidationError} When the segment is `.` or `..`, or cannot be encoded at all
 */
export const encodePathSegment = (segment: string): string => {
  // Rejected rather than encoded, because encoding does not neutralize these two. Percent-decoding
  // happens before path normalization, so `%2E%2E` traverses exactly as `..` does — in Node,
  // `new URL('http://h/a/%2E%2E/b').pathname` is `/b` either way. Refusing costs nothing: no
  // identifier this function is handed is `.` or `..`, so only an attempt to climb the path is
  // turned away, and it is turned away as a 400 rather than sent upstream to be resolved.
  if (segment === '.' || segment === '..') {
    throw ServiceValidationError.forField('path_segment', 'Identifier is not a valid path segment.', {
      operation: 'encode_path_segment',
      service: 'url_validation',
    });
  }

  try {
    return encodeURIComponent(segment);
  } catch {
    // `encodeURIComponent` throws `URIError` on an unpaired UTF-16 surrogate — and `JSON.parse`
    // accepts one, so a body-supplied identifier can be a string the encoder cannot represent. Left
    // to propagate, it leaves this helper as an unhandled error and the caller gets a 500 for what
    // is a malformed request, so it is refused the same way a dot-only segment is.
    throw ServiceValidationError.forField('path_segment', 'Identifier is not a valid path segment.', {
      operation: 'encode_path_segment',
      service: 'url_validation',
    });
  }
};

/**
 * Validates and sanitizes a URL to prevent open redirect attacks
 * @param url - The URL to validate
 * @param allowedDomains - Array of allowed domains (optional)
 * @returns The sanitized URL or null if invalid
 */
export const validateAndSanitizeUrl = (url: string, allowedDomains?: string[]): string | null => {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    // Ensure the URL has a protocol
    const urlWithProtocol = url.startsWith('http://') || url.startsWith('https://') ? url : `${process.env['PCC_BASE_URL']}${url}`;
    const parsedUrl = new URL(urlWithProtocol);

    // Validate protocol
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return null;
    }

    // If allowed domains are specified, validate against them
    if (allowedDomains && allowedDomains.length > 0) {
      const domain = parsedUrl.origin.toLowerCase();
      const isAllowed = allowedDomains.some((allowedDomain) => domain === allowedDomain.toLowerCase());

      if (!isAllowed) {
        return null;
      }
    }

    // Return the original URL if it's relative, otherwise return the validated URL
    return parsedUrl.toString();
  } catch {
    return null;
  }
};

/**
 * Domain allowlist for each environment
 */
const DOMAIN_ALLOWLIST = {
  development: ['auth0.InaRygxwVLWCKf6k6rmOc25mTPvvBrDy.is.authenticated', 'auth-linuxfoundation-dev.auth0.com'],
  staging: ['auth-linuxfoundation-staging.auth0.com'],
  production: ['auth-sso.linuxfoundation.org'],
};

/**
 * Extracts domain from a cookie string
 * @param cookie - The cookie string to parse
 * @returns The extracted domain or null if invalid
 */
const extractDomainFromCookie = (cookie: string): string | null => {
  if (!cookie || typeof cookie !== 'string') {
    return null;
  }

  try {
    // Additional security checks for cookie format
    if (cookie.length > 4096) {
      // RFC 6265: Cookies should not exceed 4096 bytes
      return null;
    }

    // Check for suspicious cookie patterns
    if (cookie.includes(';') && cookie.includes('=') && cookie.includes('domain=')) {
      // Parse the cookie to extract domain
      const cookieParts = cookie.split(';');
      const domainPart = cookieParts.find((part) => part.trim().toLowerCase().startsWith('domain='));

      if (domainPart) {
        // Extract domain value
        const domain = domainPart.split('=')[1]?.trim();
        if (domain && domain.length > 0 && domain.length < 253) {
          return domain;
        }
      }
    }

    // If no domain is specified, try to extract from the cookie name
    // This handles cases where the cookie name itself contains the domain
    const cookieName = cookie.split('=')[0]?.trim();
    if (cookieName && cookieName.length > 0 && cookieName.length < 4096) {
      // Only accept specific cookie patterns that match our allowlist
      // This prevents accepting random Auth0 cookies from any domain

      // Check for our specific Auth0 cookie pattern
      if (cookieName.includes('auth0.') && cookieName.includes('.is.authenticated')) {
        // Extract the specific Auth0 client ID from the cookie name
        const auth0Pattern = /^auth0\.([^.]+)\.is\.authenticated$/;
        const match = cookieName.match(auth0Pattern);
        if (match) {
          const clientId = match[1];
          // Only accept if it matches our specific client ID
          if (clientId === 'jStGXyf3nwTswv8goh6FcbU4EaWUZBNP') {
            return cookieName;
          }
        }
        return null;
      }

      // Check for Linux Foundation specific domains only
      if (cookieName.includes('linuxfoundation') || cookieName.includes('auth-sso')) {
        // Validate against our specific domain patterns
        const validPatterns = [/^auth-linuxfoundation-dev\.auth0\.com$/, /^auth-linuxfoundation-staging\.auth0\.com$/, /^auth-sso\.linuxfoundation\.org$/];

        for (const pattern of validPatterns) {
          if (pattern.test(cookieName)) {
            return cookieName;
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Validates if a cookie domain is allowed for the current environment
 * @param cookie - The cookie string to validate
 * @param environment - The current environment (development, staging, production)
 * @returns True if the cookie domain is allowed, false otherwise
 */
export const validateCookieDomain = (cookie: string, environment: keyof typeof DOMAIN_ALLOWLIST): boolean => {
  if (!cookie || !environment || !DOMAIN_ALLOWLIST[environment]) {
    return false;
  }

  const extractedDomain = extractDomainFromCookie(cookie);
  if (!extractedDomain) {
    return false;
  }

  const allowedDomains = DOMAIN_ALLOWLIST[environment];
  const normalizedExtractedDomain = extractedDomain.toLowerCase();

  // Additional security checks
  // Prevent domain spoofing attacks
  if (
    normalizedExtractedDomain.includes('..') ||
    normalizedExtractedDomain.includes('--') ||
    normalizedExtractedDomain.startsWith('.') ||
    normalizedExtractedDomain.endsWith('.')
  ) {
    return false;
  }

  // Check for suspicious characters
  const suspiciousChars = /[<>"'&]/;
  if (suspiciousChars.test(normalizedExtractedDomain)) {
    return false;
  }

  // Strict validation - only allow exact matches from our allowlist
  // This prevents accepting cookies from similar domains or subdomains
  return allowedDomains.some((allowedDomain) => {
    const normalizedAllowedDomain = allowedDomain.toLowerCase();

    // Only allow exact matches - no subdomain or parent domain matching
    return normalizedExtractedDomain === normalizedAllowedDomain;
  });
};

// ---------------------------------------------------------------------------
// SSRF-safe URL validation and fetch for scraping user-provided URLs.
// Validates protocol, port, hostname patterns, and DNS-resolved IPs.
// Fetches connect directly to DNS-resolved IPs to prevent DNS rebinding.
// ---------------------------------------------------------------------------

interface SsrfSafeTarget {
  host: string;
  hostname: string;
  port: number;
  path: string;
  resolvedIp: string;
}

async function resolveAndValidate(url: string): Promise<SsrfSafeTarget> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }

  // The SHARED rule, not a second copy of it: `canonicalHttpUrl` calls the same helper, so the
  // PORT policy has one definition. They drifted once, with `canonicalHttpUrl` persisting `:8443`
  // that this function refuses.
  //
  // Ports only. This path is https-only (above); `canonicalHttpUrl` still accepts `http:`,
  // because it also judges urls a RECIPIENT clicks and never fetches.
  const portRefusal = refuseUnfetchablePort(parsed);
  if (portRefusal !== '') {
    throw new Error(portRefusal);
  }
  // The number the CONNECTION needs, after the policy has approved it. Defaults to 443 because
  // the scheme is https-only above, and WHATWG leaves `parsed.port` empty for a default port.
  const port = parsed.port ? Number(parsed.port) : 443;

  const hostname = parsed.hostname.toLowerCase();
  // The SHARED judge, not a second denylist. A module-local `PRIVATE_IP_PATTERNS` lived here
  // and had drifted badly from `isPrivateHost`: it missed CGNAT (100.64/10), NAT64
  // (64:ff9b::/96), 6to4 (2002::/16), multicast, site-local, RFC5737 and RFC2544 -- nine of ten
  // sampled addresses that isPrivateHost rejects sailed through this, the REAL fetch path.
  //
  // Two encodings of one rule always drift, and the one nobody is hardening is the one that
  // matters. The local list was deleted rather than extended, so there is one place to fix.
  if (isPrivateHost(hostname)) {
    throw new Error('URLs targeting private/internal hosts are not allowed');
  }

  const { promises: dns } = await import('node:dns');
  let addresses4: string[];
  let addresses6: string[];
  try {
    [addresses4, addresses6] = await Promise.all([
      dns.resolve4(hostname).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return [];
        throw err;
      }),
      dns.resolve6(hostname).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return [];
        throw err;
      }),
    ]);
  } catch {
    throw new Error('DNS resolution failed — cannot verify host safety');
  }
  const allAddresses = [...addresses4, ...addresses6];
  if (allAddresses.length === 0) {
    throw new Error('DNS resolution returned no addresses');
  }
  for (const addr of allAddresses) {
    // isPrivateHost normalizes the IPv4-mapped form itself, so there is no strip to do here --
    // and judging a hand-stripped copy alongside it would be a second encoding of the same rule
    // this file already delegates to the shared judge.
    if (isPrivateHost(addr)) {
      throw new Error('Blocked host: resolves to private IP');
    }
  }

  return { host: parsed.host, hostname, port, path: `${parsed.pathname}${parsed.search}`, resolvedIp: allAddresses[0] };
}

export async function validateScrapeUrl(url: string): Promise<string> {
  const target = await resolveAndValidate(url);
  return `https://${target.host}${target.path}`;
}

/**
 * Bytes of response body this fetch will accumulate before abandoning the request.
 *
 * The 15s timeout bounds TIME, not MEMORY: on a fast link a server can stream gigabytes inside it,
 * and every byte is buffered here before any caller sees it. This is a server-side fetch of a
 * user-supplied URL, so the size is chosen by whoever supplies the URL.
 *
 * 5 MiB is far above any real event page -- the largest we scrape are ~1 MiB of markup -- and far
 * below what threatens the process. The consumer (`extractableHtml`) caps its own input at 150k
 * characters anyway, so nothing downstream wants more than this.
 *
 * The request is DESTROYED on breach rather than truncated: a truncated page is a page that lies
 * about its own content, and would be handed to an extraction prompt as though complete. Failing
 * loudly is the honest outcome, and matches how the other guards in this file behave.
 */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export async function fetchSafeUrl(url: string, signal: AbortSignal): Promise<{ html: string; ok: boolean; status: number; finalUrl: string }> {
  const https = await import('node:https');
  const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);

  const doRequest = (t: SsrfSafeTarget): Promise<{ body: string; statusCode: number; location?: string }> =>
    new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: t.resolvedIp,
          port: t.port,
          path: t.path,
          method: 'GET',
          headers: { Host: t.host, 'User-Agent': 'Mozilla/5.0 (compatible; LFX/1.0)' },
          servername: t.hostname,
          signal: combinedSignal,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let received = 0;
          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > MAX_RESPONSE_BYTES) {
              // Destroy the REQUEST, not just the response: this stops the transfer at the socket
              // rather than letting the remote keep streaming into a buffer nobody will read. The
              // reject lands before the 'end' handler can resolve, so no partial body escapes.
              req.destroy();
              reject(new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            const loc = res.headers['location'];
            resolve({ body: Buffer.concat(chunks).toString('utf-8'), statusCode: res.statusCode ?? 0, location: Array.isArray(loc) ? loc[0] : loc });
          });
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.end();
    });

  let target = await resolveAndValidate(url);
  let result = await doRequest(target);

  let redirectCount = 0;
  while (result.statusCode >= 300 && result.statusCode < 400 && redirectCount < 5) {
    if (!result.location) break;
    const nextUrl = new URL(result.location, `https://${target.host}${target.path}`).href;
    target = await resolveAndValidate(nextUrl);
    result = await doRequest(target);
    redirectCount++;
  }

  // The FINAL url, after every hop. Relative values in the fetched HTML (`og:image`,
  // sponsor `src`) must resolve against the page that actually served them: if `/old` redirects
  // to another host or directory and returns `content="hero.jpg"`, resolving against the
  // ORIGINAL url points at a path that does not exist and the image silently disappears.
  //
  // Safe to hand back without re-validating: `target` is the output of `resolveAndValidate` for
  // whichever hop produced this response, so every url returned here has already passed the
  // same SSRF checks as the first one.
  const finalUrl = `https://${target.host}${target.path}`;

  if (result.statusCode < 200 || result.statusCode >= 300) {
    return { html: '', ok: false, status: result.statusCode, finalUrl };
  }

  return { html: result.body, ok: true, status: result.statusCode, finalUrl };
}
