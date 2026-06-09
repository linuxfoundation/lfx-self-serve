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
// ---------------------------------------------------------------------------

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^::1$/,
  /^::ffff:\d+\.\d+\.\d+\.\d+$/i,
  /^f[cd][0-9a-f]{2}:/i,
  /^fe80:/i,
];

export async function validateScrapeUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }

  const port = parsed.port ? Number(parsed.port) : 443;
  if (port !== 80 && port !== 443) {
    throw new Error('Only ports 80 and 443 are allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (PRIVATE_IP_PATTERNS.some((p) => p.test(hostname))) {
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
  for (const addr of [...addresses4, ...addresses6]) {
    const checkAddr = addr.replace(/^::ffff:/i, '');
    if (PRIVATE_IP_PATTERNS.some((p) => p.test(checkAddr))) {
      throw new Error('Blocked host: resolves to private IP');
    }
  }

  return `https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export async function fetchSafeUrl(url: string, signal: AbortSignal): Promise<{ html: string; ok: boolean; status: number }> {
  const safeUrl = await validateScrapeUrl(url);
  let response = await fetch(safeUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LFX/1.0)' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    redirect: 'manual',
  });

  let redirectCount = 0;
  let currentUrl = safeUrl;
  while (response.status >= 300 && response.status < 400 && redirectCount < 5) {
    const location = response.headers.get('location');
    if (!location) break;
    currentUrl = await validateScrapeUrl(new URL(location, currentUrl).href);
    response = await fetch(currentUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LFX/1.0)' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      redirect: 'manual',
    });
    redirectCount++;
  }

  if (!response.ok) {
    return { html: '', ok: false, status: response.status };
  }

  return { html: await response.text(), ok: true, status: response.status };
}
