// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Basic regex pattern to identify potential URLs in text
 * This is used for initial detection only, followed by proper URL validation.
 * Pattern matches http:// or https:// followed by non-whitespace/control characters.
 * We intentionally exclude common dangerous characters: <>"{}|\^`[]
 */
const URL_DETECTION_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/**
 * List of additional dangerous URL patterns to reject
 */
const DANGEROUS_URL_PATTERNS = [/javascript:/i, /data:/i, /vbscript:/i, /file:/i, /ftp:/i];

/**
 * Validates if a string is a valid and safe URL
 * @param urlString - The URL string to validate
 * @returns true if the URL is valid and safe
 */
export function isValidUrl(urlString: string): boolean {
  // Check for dangerous URL patterns first
  for (const pattern of DANGEROUS_URL_PATTERNS) {
    if (pattern.test(urlString)) {
      console.debug('Rejected dangerous URL pattern', urlString);
      return false;
    }
  }

  try {
    const url = new URL(urlString);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      console.debug('Invalid URL protocol', url.protocol, urlString);
      return false;
    }

    // Basic hostname validation
    if (!url.hostname || url.hostname.length < 3) {
      console.debug('Invalid hostname', url.hostname, urlString);
      return false;
    }

    // Reject localhost and private IP ranges for security
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.') ||
      hostname.startsWith('192.168.') ||
      hostname === '0.0.0.0'
    ) {
      console.debug('Rejected private/local URL', urlString);
      return false;
    }

    return true;
  } catch (error) {
    console.debug('URL validation failed', urlString, error);
    return false;
  }
}

/**
 * True for an in-app relative path (e.g. `/project/{{project.uid}}/committees/new`), false for a
 * protocol-relative value (`//host/...`) — a browser resolves that as a same-scheme cross-origin
 * URL, not a safe in-app route, so it must not be treated as one.
 * @param value - The candidate path string
 * @returns true if the value is a same-origin relative path
 */
export function isRelativeInAppPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//');
}

/**
 * Trailing characters that are almost never part of an intended URL when found at the end
 * of a regex match — sentence punctuation and quotes (e.g. `Visit https://example.com.`
 * should link `https://example.com`, not the trailing period).
 *
 * Held as a `Set` (not a regex) and stripped with a bounded character loop: a `+`-quantified
 * class anchored at the end (`/[...]+$/`) trips CodeQL's "polynomial regular expression used on
 * uncontrolled data" rule when the input is user-supplied comment text. The loop visits each
 * trailing char at most once, so the trim is strictly linear.
 */
const TRAILING_PUNCTUATION_CHARS: ReadonlySet<string> = new Set(['.', ',', ';', ':', '!', '?', "'", '"', '’', '”']);

/**
 * Trailing bracket closers — only stripped when unmatched inside the URL, so legitimately
 * bracketed paths (e.g. Wikipedia's `https://en.wikipedia.org/wiki/Foo_(bar)`) keep them.
 * Only `)` is listed: the detection regex never admits `[]{}'` into a match, so those
 * closers can never trail one.
 */
const TRAILING_BRACKETS: Record<string, string> = { ')': '(' };

/**
 * Trims sentence punctuation and unmatched closing brackets off the end of a detected URL.
 * The detection regex greedily consumes non-whitespace characters, so prose like
 * `(see https://linuxfoundation.org),` otherwise links the trailing `),`.
 * @param url - The raw regex match
 * @returns The URL with prose trailing punctuation removed
 */
function trimTrailingPunctuation(url: string): string {
  let trimmed = url;

  // Tally each bracket pair's balance up front so every strip below is O(1) — re-counting per strip would compound to O(n^2) on adversarial input.
  // Punctuation stripping never removes bracket chars (the sets are disjoint), so the tallies stay valid across the fixpoint loop.
  const unmatchedClosers = new Map<string, number>();
  for (const [closer, opener] of Object.entries(TRAILING_BRACKETS)) {
    let balance = 0;
    for (const char of trimmed) {
      if (char === closer) {
        balance++;
      } else if (char === opener) {
        balance--;
      }
    }
    unmatchedClosers.set(closer, balance);
  }

  // Fixpoint loop: stripping an unmatched bracket can expose new trailing punctuation
  // (`https://example.com/page.)` → strip `)` → now-trailing `.`), so the two passes
  // re-run until neither strips anything. Each pass visits each char at most once.
  let changed = true;
  while (changed && trimmed.length > 0) {
    changed = false;

    while (trimmed.length > 0 && TRAILING_PUNCTUATION_CHARS.has(trimmed.charAt(trimmed.length - 1))) {
      trimmed = trimmed.slice(0, -1);
      changed = true;
    }

    let lastChar = trimmed.charAt(trimmed.length - 1);
    let balance = unmatchedClosers.get(lastChar);
    while (balance !== undefined && balance > 0) {
      trimmed = trimmed.slice(0, -1);
      balance--;
      unmatchedClosers.set(lastChar, balance);
      changed = true;
      lastChar = trimmed.charAt(trimmed.length - 1);
      balance = unmatchedClosers.get(lastChar);
    }
  }

  return trimmed;
}

/**
 * Extracts all valid URLs from a given text string
 * @param text - The text to extract URLs from
 * @returns Array of validated URL strings found in the text
 */
export function extractUrls(text: string): string[] {
  if (!text) {
    return [];
  }

  const potentialUrls = [...text.matchAll(URL_DETECTION_REGEX)];
  const validUrls: string[] = [];

  potentialUrls.forEach((match) => {
    const url = trimTrailingPunctuation(match[0]);
    if (isValidUrl(url)) {
      validUrls.push(url);
    }
  });

  return validUrls;
}

/**
 * Checks if a string is a valid domain by attempting to create a URL
 * @param domain - The domain string to validate
 * @returns true if the domain is valid
 */
export function isValidDomain(domain: string): boolean {
  if (!domain || typeof domain !== 'string') {
    return false;
  }

  const trimmedDomain = domain.trim();
  if (!trimmedDomain || trimmedDomain.length < 3) {
    return false;
  }

  // Case-insensitive protocol detection
  const hasProtocol = /^https?:\/\//i.test(trimmedDomain);

  let candidateUrl: string;
  if (hasProtocol) {
    // Already has protocol, use as-is
    candidateUrl = trimmedDomain;
  } else {
    // No protocol, build HTTPS candidate from host (with optional path)
    candidateUrl = `https://${trimmedDomain}`;
  }

  // Try to create and validate the URL
  try {
    const url = new URL(candidateUrl);

    // Check if hostname is valid and contains at least one dot (for TLD)
    return url.hostname.length > 0 && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * Prefixes a relative path with `window.location.origin` when running in the browser.
 * SSR fallback: `window` is undefined during server rendering, so this must return the
 * relative path when `isBrowser` is false regardless of when the caller evaluates it.
 * @param path - The relative path (e.g. `/meetings/123`)
 * @param isBrowser - Result of `isPlatformBrowser(platformId)` from the calling component
 * @returns The absolute URL when in the browser, otherwise the relative path unchanged
 */
export function toAbsoluteUrl(path: string, isBrowser: boolean): string {
  if (!isBrowser) return path;
  return `${window.location.origin}${path}`;
}

/**
 * Converts a domain to a full URL or validates an existing URL
 * @param input - The domain or URL string to process
 * @returns A valid URL string or null if invalid
 */
export function normalizeToUrl(input: string): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmedInput = input.trim();

  // If it already looks like a URL, validate it using existing function
  if (trimmedInput.startsWith('http://') || trimmedInput.startsWith('https://')) {
    return isValidUrl(trimmedInput) ? trimmedInput : null;
  }

  // If it's a valid domain, convert to HTTPS URL (preserve www if present)
  if (isValidDomain(trimmedInput)) {
    const url = `https://${trimmedInput}`;
    return isValidUrl(url) ? url : null;
  }

  return null;
}

/**
 * Whether a router URL is under the /profile hub, matching on the route-segment boundary.
 * Strips both the query string and the fragment before matching, so a bare prefix
 * check does not misclassify sibling routes (`/profiles`, `/profile-old`), and a fragment
 * (e.g. `/profile/settings#developer-settings`) does not defeat the match.
 * @param url - The router URL (may include `?query` and/or `#fragment`)
 * @returns true when the path is exactly `/profile` or under `/profile/`
 */
export function isProfileHubPath(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return path === '/profile' || path.startsWith('/profile/');
}
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
  // Trailing ROOT DOTS are stripped first, ALL of them. `new URL('http://localhost./x').hostname`
  // keeps the dot, and a resolver treats `localhost.` and `localhost` as the same absolute name;
  // stripping only one left `localhost..` as a live bypass. This is the fourth evasion of this
  // function (IPv6-mapped hex, one dot, many dots), which is why the tail below now fails CLOSED
  // rather than returning false for anything it does not recognise.
  // Trailing dots trimmed by INDEX rather than a regex: `/\.+$/` on caller-controlled input is
  // polynomial-time backtracking (CodeQL flags it), and this input is exactly that.
  const lowered = hostname.toLowerCase();
  let end = lowered.length;
  while (end > 0 && lowered[end - 1] === '.') end--;
  const host = lowered.slice(0, end);
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true;

  // An empty label anywhere else (`local..host`, `..localhost`) is not a valid hostname. It
  // cannot resolve, so nothing legitimate is refused by treating it as suspicious — and it is
  // exactly the shape a bypass attempt takes.
  if (host.includes('..')) return true;

  // Strip IPv6 brackets, then fold an IPv4-mapped/compatible address back to its IPv4 form so
  // the one set of rules below judges every spelling.
  // An UNMATCHED bracket is not a hostname at all; refuse rather than letting it reach the name
  // path, where `[::1` would read as an ordinary label.
  if (host.startsWith('[') !== host.endsWith(']')) return true;
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
  // A NAME rather than an IPv4 literal is allowed: this function cannot resolve, so a DNS name
  // pointing into private space is the dial-time guard's job (see the note above). But a name is
  // a name only if it LOOKS like one — every label alphanumeric-or-hyphen, and no label that is
  // purely digits, which would make it a malformed IP literal rather than a hostname. Anything
  // else fails closed, so a fifth spelling of an address is refused rather than allowed.
  if (octets.length !== 4) {
    const labels = host.split('.');
    // Every label must be a valid one. The numeric test applies to the host as a WHOLE, not to
    // each label: `123.example.com` and `2024.events.example.com` are ordinary hostnames, and
    // rejecting them was a false positive. An ALL-numeric dotted host is not a name at all --
    // it is a malformed IP literal, which is what must fail closed.
    const everyLabelValid = labels.every((l) => /^[a-z0-9-]+$/.test(l));
    const allNumeric = labels.every((l) => /^[0-9]+$/.test(l));
    return !everyLabelValid || allNumeric;
  }
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

/**
 * The canonical http(s) form of `value`, or '' when it is not a usable public URL.
 *
 * ONE implementation, because the server's allow-list and the client's preview must agree
 * exactly: they diverged three times in review — scheme-only vs host-checked, raw vs canonical,
 * and userinfo kept vs stripped — and each divergence let the preview show something the staged
 * draft would not contain.
 *
 * Canonical rather than the input: WHATWG `URL` accepts `http:example.com` and reports an
 * `http:` protocol, so returning the original forwards a non-network-absolute value. Userinfo is
 * dropped because these URLs are fetched server-side and rendered into a SENT email, so embedded
 * credentials would travel into the message and every log that records the fetch.
 */
export function canonicalHttpUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed === '') return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (isPrivateHost(parsed.hostname)) return '';
    parsed.username = '';
    parsed.password = '';
    return parsed.href;
  } catch {
    return '';
  }
}
