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
 * Wildcard-DNS services that resolve a spelled-out address to that address.
 *
 * The bypass only works through a resolver that performs that mapping, so the spelled-address
 * scan is limited to these. Scanning every hostname instead over-blocks ordinary version and
 * build labels (`release-10-0-0-5.example.com`), and a false positive here silently drops a
 * legitimate hero image or CTA.
 */
const WILDCARD_DNS_SUFFIXES = ['nip.io', 'sslip.io', 'xip.io'];

/**
 * Every packed IPv4 address a single DNS label could be spelling, under a wildcard-DNS suffix.
 *
 * Returns a LIST, not one value, because a label can be read more than one way and guessing
 * wrong is how an address slips past. `10000000` is 0.152.150.128 read as decimal and 16.0.0.0
 * read as hex; an earlier version tested hex first and so judged the wrong address entirely.
 * Both readings are now checked and either one being private is enough to refuse.
 *
 * AFFIXES are stripped before decoding. nip.io and sslip.io document `<prefix>-<address>`, so
 * `app-c0a801fc.nip.io` is 192.168.1.252 -- decoding only whole labels let that straight through
 * while the bare `c0a801fc.nip.io` was refused, which is the same "one spelling handled, the
 * next one not" trap this function keeps falling into.
 *
 * Only called under a wildcard-DNS suffix, because outside one a hex-shaped label is a word:
 * `deadbeef.example.com` is a hostname, not 222.173.190.239.
 */
function packedAddressCandidates(label: string): number[] {
  // The address is the LAST dash-separated segment -- `app-c0a801fc` and `web-01-0a000803`.
  const segments = label.split('-');
  const candidates: number[] = [];

  for (const segment of [label, segments[segments.length - 1]]) {
    if (segment === undefined || segment === '') continue;
    // Decimal FIRST: an all-digit label is decimal, even though it also matches hex.
    if (/^\d{8,10}$/.test(segment)) candidates.push(Number(segment));
    if (/^0x[0-9a-f]{8}$/.test(segment)) candidates.push(parseInt(segment.slice(2), 16));
    if (/^[0-9a-f]{8}$/.test(segment)) candidates.push(parseInt(segment, 16));
  }

  return candidates.filter((value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff);
}

/**
 * The IPv6 address a label spells in sslip.io's dash notation, or '' when it spells none.
 *
 * sslip.io maps `-` to `:`, so `fd00--1.sslip.io` is `fd00::1` and `--1.sslip.io` is `::1` --
 * both private, and neither reachable by the IPv4 scans above.
 */
function dashNotationIPv6(label: string): string {
  // sslip.io also accepts the address as 32 bare hex digits, no separators at all --
  // `fd001234567890abcdef1234567890ab.sslip.io`. No dash to key off, so the dash branch below
  // could never see it.
  if (/^[0-9a-f]{32}$/.test(label)) {
    return (label.match(/.{4}/g) ?? []).join(':');
  }
  if (!label.includes('-')) return '';
  const candidate = label.replace(/-/g, ':');
  if (!/^[0-9a-f:]+$/.test(candidate)) return '';
  // An EXPANDED dash form has no `::` but is still a full address: `fd00-0-0-0-0-0-0-1`.
  // Requiring `::` refused it, so only the compressed spelling was decoded.
  if (!candidate.includes('::') && candidate.split(':').length !== 8) return '';
  return candidate;
}

/**
 * Wildcard services that resolve EVERYTHING under them to loopback, without spelling an address.
 *
 * Listing these beside the spelled-address suffixes was worse than omitting them: it made them
 * look handled while the scan could never match, because there is no address in the name to find.
 * They are denied outright instead -- `anything.localtest.me` is 127.0.0.1.
 */
const LOOPBACK_WILDCARD_SUFFIXES = ['localtest.me', 'lvh.me', 'traefik.me'];

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
 * WHAT THIS DOES: normalises the host (trailing root
 * dots, IPv6 compression expanded) before judging it; decodes translated encodings that carry an
 * IPv4 destination (IPv4-mapped, IPv4-compatible, RFC 2765 translated, NAT64 64:ff9b::/96, 6to4
 * 2002::/16); denies literal private, loopback, link-local, site-local and CGNAT ranges; scans
 * for spelled-out addresses under known wildcard-DNS suffixes in dotted, dash, hex and packed
 * forms -- including affixed and IPv6 dash spellings, with EVERY reading of an ambiguous label
 * checked rather than one guessed; and FAILS CLOSED on any host that is neither a judged IP
 * literal nor a well-formed name.
 *
 * Each of those decode branches can also produce a FALSE POSITIVE, which has happened repeatedly
 * here and is why the wildcard-DNS scan is gated to those suffixes and the negative cases are
 * tested as carefully as the positive ones: `release-10-0-0-5.example.com`, `163.com`,
 * `my_cdn.example.com` and `[::ffff:8.8.8.8]` are all ordinary and were all refused at some
 * point. Dropping a legitimate hero image is a real defect, not a safe default.
 *
 * It remains a DENYLIST, not proof of a public address: a hostname that RESOLVES to a private IP
 * still passes here, and campaign-service's dial-time guard -- which judges the resolved address
 * and closes the DNS-rebinding window -- stays the authoritative check. This stops the payload
 * from ever being persisted.
 */
export function isPrivateHost(hostname: string): boolean {
  // Trailing ROOT DOTS are stripped first, ALL of them. `new URL('http://localhost./x').hostname`
  // keeps the dot, and a resolver treats `localhost.` and `localhost` as the same absolute name;
  // stripping only one left `localhost..` as a live bypass. Evasions found in review so far:
  // IPv6-mapped hex, one trailing dot, many trailing dots, wildcard-DNS dotted and dash spellings,
  // 0x-prefixed / bare-hex / packed-decimal labels, the same with a `<prefix>-` affix, sslip.io's
  // dash-notation IPv6, NAT64 and 6to4 translation, and blanket-loopback wildcard domains. All
  // one address wearing a different spelling, which is why the tail below fails CLOSED rather
  // than returning false for anything it does not recognise -- and why the fixes for them are
  // structural (normalise, expand, decode every reading) instead of one pattern per spelling.
  // Trailing dots trimmed by INDEX rather than a regex: `/\.+$/` on caller-controlled input is
  // polynomial-time backtracking (CodeQL flags it), and this input is exactly that.
  const lowered = hostname.toLowerCase();
  let end = lowered.length;
  while (end > 0 && lowered[end - 1] === '.') end--;
  const host = lowered.slice(0, end);
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (LOOPBACK_WILDCARD_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;

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
  // Split into groups and inspect them, rather than matching a `(?:0*:)*` prefix: that construct
  // is the polynomial-backtracking shape CodeQL flags, and the same decision is a linear scan.
  // EXPAND `::` before reading groups. Compression can elide a zero group INSIDE the embedded
  // address -- `[64:ff9b::a9fe]` is NAT64 for 0.0.169.254 -- so positional reads on the raw
  // split silently decode the wrong thing or skip it entirely. Expanding first means one
  // decode path handles every spelling of the same address.
  const expandIPv6 = (value: string): string[] => {
    if (!value.includes('::')) return value.split(':');
    const [left, right] = value.split('::');
    const head = left ? left.split(':') : [];
    const tail = right ? right.split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return value.split(':');
    return [...head, ...Array(missing).fill('0'), ...tail];
  };
  const parts = expandIPv6(addr);
  const leadingZeroGroupsOnly = parts.slice(0, -3).every((g) => g === '' || /^0+$/.test(g));
  const tail = parts.slice(-3);
  const isMappedHex = parts.length >= 3 && leadingZeroGroupsOnly && tail[0] === 'ffff' && tail.slice(1).every((g) => /^[0-9a-f]{1,4}$/.test(g));
  const dotted = parts[parts.length - 1];
  const isMappedDotted =
    parts.length >= 2 && parts.slice(0, -1).every((g) => g === '' || g === 'ffff' || /^0+$/.test(g)) && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(dotted);

  // IPv4-COMPATIBLE (::/96) carries the address in the last two groups with no `ffff` marker,
  // so the mapped checks above miss it: `[::a9fe:a9fe]` is the metadata endpoint.
  // RFC 2765 IPv4-TRANSLATED (::ffff:0:0/96) puts a zero group between the marker and the
  // address: `[::ffff:0:a9fe:a9fe]`. Same family as the mapped form, one group further out.
  const isTranslatedHex =
    parts.length >= 4 &&
    parts[parts.length - 4] === 'ffff' &&
    /^0+$/.test(parts[parts.length - 3] ?? '') &&
    parts.slice(0, -4).every((g) => g === '' || /^0+$/.test(g)) &&
    parts.slice(-2).every((g) => /^[0-9a-f]{1,4}$/.test(g));

  const isCompatHex =
    parts.length >= 3 &&
    parts.slice(0, -2).every((g) => g === '' || /^0+$/.test(g)) &&
    parts.slice(-2).every((g) => /^[0-9a-f]{1,4}$/.test(g)) &&
    addr.startsWith('::');

  if (isMappedHex) {
    const hi = parseInt(tail[1], 16);
    const lo = parseInt(tail[2], 16);
    addr = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  } else if (isTranslatedHex || isCompatHex) {
    const hi = parseInt(parts[parts.length - 2], 16);
    const lo = parseInt(parts[parts.length - 1], 16);
    addr = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  } else if (isMappedDotted) {
    addr = dotted;
  } else if (addr.includes(':')) {
    // A genuine IPv6 literal: ::1 loopback, fe80::/10 link-local, fc00::/7 unique-local.
    // The FIRST group positionally, defaulting to 0 when compression elides it -- not the first
    // non-empty one. `::1` and its expanded twin `0000:...:0001` are the same address, and a
    // string compare against '::1' matched only the compressed spelling.
    // `parts` is the expansion computed above. Take the first group POSITIONALLY -- compression
    // can elide it, and `groups.find(g => g !== '')` returned the first non-empty one instead,
    // which is a different group entirely for `::1`.
    const first = (parts[0] ?? '').replace(/^0+(?=.)/, '');

    // All-zero except a trailing 0 or 1 is the unspecified address or loopback. Judged on the
    // EXPANDED groups, so `[::1]` and `[0000:...:0001]` -- the same address -- are both caught.
    // A string compare against '::1' matched only the compressed spelling.
    if (parts.length === 8) {
      const values = parts.map((g) => (g === '' ? 0 : parseInt(g, 16)));
      if (values.slice(0, 7).every((v) => v === 0) && (values[7] === 0 || values[7] === 1)) return true;
    }
    if (addr === '::' || addr === '::1' || /^fe[89ab]/.test(first) || /^f[cd]/.test(first) || /^fe[c-f]/.test(first)) return true;

    // TRANSLATED forms carry an IPv4 destination inside an IPv6 address, so judging the IPv6
    // literal alone misses it entirely: 64:ff9b::/96 is well-known NAT64 (RFC 6052) and
    // 2002::/16 is 6to4 (RFC 3056). campaign-service's dial-time guard decodes NAT64 for exactly
    // this reason; mirroring it here keeps the persisted value from carrying the payload at all.
    // The last two groups are the embedded IPv4 in both encodings.
    const isNat64 = /^0*64:ff9b:/.test(addr);
    const is6to4 = /^2002:/.test(addr);
    if (isNat64 || is6to4) {
      // The EXPANDED groups, not the non-empty ones: compression can elide a zero group inside
      // the embedded address (`[64:ff9b::a9fe]` is 0.0.169.254), and filtering empties reads the
      // wrong pair or none at all. `parts` is already expanded above.
      const pair = isNat64 ? parts.slice(-2) : parts.slice(1, 3);
      if (pair.length === 2 && pair.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
        const hi = parseInt(pair[0], 16);
        const lo = parseInt(pair[1], 16);
        return isPrivateHost(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
      }
      // Declared as a translation prefix but undecodable: refuse rather than fall through.
      return true;
    }
    return false;
  }

  // A NAME that EMBEDS a dotted-quad is the wildcard-DNS bypass shape: `169.254.169.254.nip.io`
  // and `10.0.0.1.sslip.io` resolve to the address they spell out. This is a signature, not
  // resolution -- a name pointing at private space without spelling it stays this function's
  // documented limitation and the dial-time guard's job -- but the spelled-out form is both the
  // common bypass and cheap to deny.
  // Guarded against self-recursion: a bare dotted-quad matches this pattern as itself, so only
  // a quad with a LABEL beside it is an embedded one worth re-judging.
  // EVERY position, not just the first: `cdn.169.254.169.254.nip.io` and `x.10-0-0-1.sslip.io`
  // are the same bypass with a prefix label. Scanning all labels costs nothing and removes the
  // "which position" question that produced two rounds of narrower fixes.
  // NORMALIZE, then scan. Wildcard-DNS services accept the address in several spellings --
  // dotted, dash-separated, mixed, zero-padded -- and matching each one produced a round of
  // review per spelling. Treating `-` as a separator and stripping leading zeros collapses the
  // whole family into one form, so a spelling nobody has thought of is covered by construction
  // rather than by having been listed.
  //
  // Every consecutive run of four numeric parts is checked, at any position, so a prefix or
  // suffix label changes nothing either.
  // GATED to the services that actually do this. Scanning every hostname for four consecutive
  // small numbers over-blocks: `release-10-0-0-5.example.com` and `build-192-168-1-1.ci.example`
  // are ordinary version and build labels, and refusing them silently drops legitimate content --
  // the same failure mode this change fixes elsewhere. A wildcard-DNS bypass only works through
  // a resolver that maps the spelling to the address, so only those suffixes are scanned.
  if (WILDCARD_DNS_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    // Hex and decimal spellings of the whole address, which these services also accept:
    // `0xa9fea9fe.nip.io` and `2852039166.nip.io` are both 169.254.169.254.
    for (const label of host.split('.')) {
      for (const packed of packedAddressCandidates(label)) {
        const quad = `${(packed >>> 24) & 0xff}.${(packed >>> 16) & 0xff}.${(packed >>> 8) & 0xff}.${packed & 0xff}`;
        if (isPrivateHost(quad)) return true;
      }
      const spelled = dashNotationIPv6(label);
      if (spelled !== '' && isPrivateHost(`[${spelled}]`)) return true;
    }

    // Every label is scanned. Two failure modes meet here and both are real, so neither a blanket
    // exclusion nor a blanket scan works:
    //
    //   - Excluding IPv6-parseable labels let `10-0-0-1-2-3-4-5.nip.io` through: 8 hex groups,
    //     so it parsed as IPv6, while the resolver maps the host to the RFC1918 address its
    //     first four groups spell. A BYPASS. Narrowing that exclusion per LABEL still missed
    //     `0169-0254-...` (zero-padded octets) and `10-0-0-1-dead-beef-0-0` (a hex group AFTER
    //     the private quad) -- the predicate was asking the wrong question.
    //   - Scanning blindly reads the `0-0-0-0` run inside an ordinary expanded address as
    //     `0.0.0.0`, refusing `2001-4860-4860-0-0-0-0-8888.sslip.io` (Google public DNS).
    //     A FALSE POSITIVE.
    //
    // The question is not "could this LABEL be IPv4" but "does this WINDOW spell a private
    // quad". A window of four groups that are all plain decimal octets is judged; one that
    // contains a hex group or a >255 value is part of an IPv6 address and is skipped. So the
    // private quad is still found wherever it sits, and an all-hex expanded address is not
    // reinterpreted.
    // Zero-padding is stripped (`0169` -> `169`): a resolver reads them the same, so leaving
    // them un-normalised let `0169-0254-0169-0254-...` past the window test entirely.
    // Scanned PER LABEL. The window's meaning depends on how many groups its own label has --
    // `0-0-0-0.nip.io` IS the address, while the identical window inside an 8-group IPv6 label
    // is interior padding -- and splitting the whole host loses that, because the dots merge
    // every label into one sequence.
    // ONE pass over the whole host, split on BOTH separators, with NO exclusions. That covers
    // every spelling these services accept -- dotted (`169.254.169.254.nip.io`), dashed
    // (`10-0-0-1.nip.io`), mixed (`169.254-169.254.nip.io`) and affixed (`x-10-0-0-1.nip.io`) --
    // because the quad is found wherever its four groups sit.
    //
    // It FAILS CLOSED on an expanded IPv6 zero run, deliberately, after four heuristics that
    // each let something through. `0-0-0-5-dead-beef-0-0` (resolves into 0.0.0.0/8) and
    // `2001-4860-4860-0-0-0-0-8888` (Google public DNS) are structurally IDENTICAL as IPv6 --
    // eight groups, all valid hex -- and both contain a `0.0.0.x` window. Excluding by value, by
    // range, or by position admitted one or refused the other every time. Only the resolver
    // knows which reading it will use, and this function cannot ask it.
    //
    // The cost is refusing a PUBLIC expanded-IPv6 wildcard host whose zero run forms a
    // private-looking quad: someone using sslip.io expanded notation for a public v6 address as
    // an event hero image. These services exist for local development, so that is vanishingly
    // rare -- and admitting a private quad is SSRF. The trade is not close.
    const numericParts = host.split(/[.-]/).map((part) => (/^\d{1,5}$/.test(part) ? String(Number(part)) : part));
    for (let i = 0; i + 3 < numericParts.length; i++) {
      const quadParts = numericParts.slice(i, i + 4);
      if (!quadParts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) continue;
      const quad = quadParts.join('.');
      if (quad !== host && isPrivateHost(quad)) return true;
    }
  }

  // The fail-closed name check runs for EVERY label count. It used to sit behind
  // `octets.length !== 4`, so a malformed 4-label host (`foo_bar.a.b.com`) skipped it entirely
  // while the same shape at 2 or 3 labels was refused -- a label count the attacker picks for
  // free, which undoes the invariant the check exists to state.
  //
  // Underscores are permitted: they are legal in DNS labels and ordinary in internal CDN and
  // service names (`my_cdn.example.com`), so denying them refused real hosts without refusing a
  // single address spelling -- an over-denial in the opposite direction to the one this fixes.
  //
  // It judges `addr`, NOT `host`. By this point the mapped, compatible and RFC 2765 forms have
  // been DECODED into `addr`, while `host` still carries their colons and brackets -- so reading
  // `host` here refused a PUBLIC address (`[::ffff:8.8.8.8]`) purely for how it was spelled,
  // while 6to4 returned earlier and allowed the very same address. The decoded value is the one
  // every other check below reads, and it is the one that means something.
  if (!addr.split('.').every((label) => /^[a-z0-9_-]+$/.test(label))) return true;

  const octets = addr.split('.');
  // A NAME rather than an IPv4 literal is allowed: this function cannot resolve, so a DNS name
  // pointing into private space is the dial-time guard's job (see the note above). But a name is
  // a name only if it LOOKS like one — every label alphanumeric-or-hyphen, and no label that is
  // purely digits, which would make it a malformed IP literal rather than a hostname. Anything
  // else fails closed, so a fifth spelling of an address is refused rather than allowed.
  if (octets.length !== 4) {
    const labels = host.split('.');
    // Underscores allowed here for the same reason as the check above -- the two encode ONE rule
    // and must stay identical; they have drifted apart before.
    //
    // Every label must be a valid one. The numeric test applies to the host as a WHOLE, not to
    // each label: `123.example.com` and `2024.events.example.com` are ordinary hostnames, and
    // rejecting them was a false positive. An ALL-numeric dotted host is not a name at all --
    // it is a malformed IP literal, which is what must fail closed.
    const everyLabelValid = labels.every((l) => /^[a-z0-9_-]+$/.test(l));
    const allNumeric = labels.every((l) => /^[0-9]+$/.test(l));
    return !everyLabelValid || allNumeric;
  }
  // Is it a quad at all? A non-numeric label means this is a NAME, which is allowed: the
  // destructure below only read the first three, so `10.0.0.com` -- an ordinary hostname --
  // reached the RFC1918 test with `a === 10` and was refused, dropping a legitimate hero or CTA.
  if (!octets.every((o) => /^\d+$/.test(o))) return false;

  // All-numeric but out of range is a MALFORMED literal, not a name, so it fails CLOSED -- the
  // same rule the 5+-label case above applies. Checking range in the guard above would have
  // allowed `10.0.0.256` through instead.
  if (!octets.every((o) => Number(o) <= 255)) return true;

  const [a, b, c] = octets.map((o) => Number(o));

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
 * The HOST check is why this exists at all, and it carries over from the `httpUrlOrEmpty` this
 * replaced: the values it guards are fetched SERVER-SIDE by campaign-service and re-hosted as
 * publicly readable files, so an unguarded host is a read-back channel out of the cluster. It is
 * now reachable from client code too, where it additionally keeps the preview from binding a
 * host the server would refuse.
 *
 * Canonical rather than the input: WHATWG `URL` accepts `http:example.com` and reports an
 * `http:` protocol, so returning the original forwards a non-network-absolute value. Userinfo is
 * dropped because these URLs are fetched server-side and rendered into a SENT email, so embedded
 * credentials would travel into the message and every log that records the fetch.
 *
 * @param value - A candidate URL from a scraped page, a restored brief, or a direct request
 * @returns The canonical absolute http(s) URL with userinfo stripped, or '' when unusable
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
