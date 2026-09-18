// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { canonicalHttpUrl, extractUrls, isPrivateHost, isProfileHubPath, isRelativeInAppPath } from './url.utils';

describe('extractUrls', () => {
  it('extracts http and https URLs from prose', () => {
    expect(extractUrls('see http://example.com and https://linuxfoundation.org today')).toEqual(['http://example.com', 'https://linuxfoundation.org']);
  });

  it('trims sentence punctuation following the URL', () => {
    expect(extractUrls('Visit https://example.com. Thanks!')).toEqual(['https://example.com']);
    expect(extractUrls('Visit https://example.com/path?a=1, then go')).toEqual(['https://example.com/path?a=1']);
  });

  it('trims closing brackets that wrap the URL in prose', () => {
    expect(extractUrls('(see https://linuxfoundation.org)')).toEqual(['https://linuxfoundation.org']);
    expect(extractUrls('[https://example.com],')).toEqual(['https://example.com']);
  });

  it('keeps balanced brackets that are part of the URL path', () => {
    expect(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
  });

  it('re-trims punctuation exposed by stripping an unmatched bracket', () => {
    expect(extractUrls('(see https://example.com/page.)')).toEqual(['https://example.com/page']);
    expect(extractUrls('(https://example.com/page,)')).toEqual(['https://example.com/page']);
  });

  it('trims curly quotes (U+2019/U+201D) that close around a URL in prose', () => {
    expect(extractUrls('“See https://example.com/page” for details')).toEqual(['https://example.com/page']);
    expect(extractUrls('it’s at https://example.com/page’')).toEqual(['https://example.com/page']);
  });

  it('returns an empty array for empty or URL-free text', () => {
    expect(extractUrls('')).toEqual([]);
    expect(extractUrls('no links here')).toEqual([]);
  });

  it('rejects non-http(s) and unsafe URLs', () => {
    expect(extractUrls('ftp://example.com javascript:alert(1)')).toEqual([]);
  });
});

describe('isProfileHubPath', () => {
  it('matches the exact /profile route', () => {
    expect(isProfileHubPath('/profile')).toBe(true);
  });

  it('matches nested /profile/ routes', () => {
    expect(isProfileHubPath('/profile/settings')).toBe(true);
    expect(isProfileHubPath('/profile/badges')).toBe(true);
  });

  it('does not match sibling routes that share the /profile prefix', () => {
    expect(isProfileHubPath('/profiles')).toBe(false);
    expect(isProfileHubPath('/profile-old')).toBe(false);
  });

  it('strips the query string before matching', () => {
    expect(isProfileHubPath('/profile?tab=account')).toBe(true);
    expect(isProfileHubPath('/profiles?x=1')).toBe(false);
  });

  it('strips the fragment before matching', () => {
    expect(isProfileHubPath('/profile#developer-settings')).toBe(true);
    expect(isProfileHubPath('/profile/settings#developer-settings')).toBe(true);
  });

  it('strips both query and fragment before matching', () => {
    expect(isProfileHubPath('/profile/settings?tab=account#developer-settings')).toBe(true);
  });

  it('does not match unrelated routes', () => {
    expect(isProfileHubPath('/org/profile')).toBe(false);
    expect(isProfileHubPath('/meetings')).toBe(false);
    expect(isProfileHubPath('/')).toBe(false);
  });
});

describe('isRelativeInAppPath', () => {
  it('accepts an in-app relative path', () => {
    expect(isRelativeInAppPath('/project/x')).toBe(true);
    expect(isRelativeInAppPath('/project/{{project.uid}}/committees/new')).toBe(true);
  });

  it('rejects a protocol-relative value', () => {
    expect(isRelativeInAppPath('//evil.com')).toBe(false);
  });

  it('rejects an absolute URL', () => {
    expect(isRelativeInAppPath('https://example.com')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isRelativeInAppPath('')).toBe(false);
  });
});

describe('isPrivateHost', () => {
  it.each([
    ['localhost', 'localhost'],
    ['localhost with a trailing root dot', 'localhost.'],
    ['a .localhost subdomain', 'api.localhost'],
    ['loopback', '127.0.0.1'],
    ['this-host', '0.0.0.0'],
    ['cloud metadata', '169.254.169.254'],
    ['rfc1918 ten', '10.1.2.3'],
    ['rfc1918 172.16', '172.20.0.1'],
    ['rfc1918 192.168', '192.168.1.1'],
    ['carrier-grade nat', '100.100.0.1'],
    ['ipv6 loopback', '[::1]'],
    ['ipv6 link-local', '[fe80::1]'],
    ['ipv6 unique-local', '[fd00::1]'],
    ['ipv4-mapped metadata in hex', '[::ffff:a9fe:a9fe]'],
    // Trailing-dot variants. One dot got through review once; stripping only one left the
    // multi-dot form live. Both are the same absolute name to a resolver.
    ['localhost with two trailing dots', 'localhost..'],
    ['metadata with two trailing dots', '169.254.169.254..'],
    ['loopback with three trailing dots', '127.0.0.1...'],
    // Empty labels elsewhere cannot resolve, so refusing them costs nothing legitimate and
    // denies the shape a bypass attempt takes.
    ['an empty interior label', 'local..host'],
    ['a leading empty label', '..localhost'],
    // Wildcard-DNS bypass hosts spell the address they resolve to, which is a detectable
    // signature. A name that points at private space WITHOUT spelling it remains this
    // function's documented limitation and the dial-time guard's job.
    ['a nip.io metadata host', '169.254.169.254.nip.io'],
    ['a nip.io loopback host', '127.0.0.1.nip.io'],
    ['an sslip.io rfc1918 host', '10.0.0.1.sslip.io'],
    // Translated forms carry an IPv4 destination INSIDE an IPv6 address, so judging the literal
    // alone misses them. campaign-service's dial guard decodes NAT64 for the same reason.
    ['a NAT64-translated metadata address', '[64:ff9b::a9fe:a9fe]'],
    ['a 6to4-translated metadata address', '[2002:a9fe:a9fe::]'],
    // DASH notation is the same bypass in the other spelling these services accept.
    ['dash-notation metadata', '169-254-169-254.nip.io'],
    ['dash-notation rfc1918', '10-0-0-1.sslip.io'],
    ['dash-notation loopback', '127-0-0-1.nip.io'],
    // Prefixed labels: the signature is scanned at EVERY position now, not just the first.
    ['a prefixed dotted wildcard host', 'cdn.169.254.169.254.nip.io'],
    ['a prefixed dash wildcard host', 'x.10-0-0-1.sslip.io'],
    // These two were never enumerated. They are caught because the host is NORMALIZED before
    // scanning -- `-` treated as a separator, leading zeros stripped -- rather than because
    // someone listed the spelling. That is the point of normalising instead of matching.
    ['a mixed dot-dash spelling', '169.254-169.254.nip.io'],
    ['a zero-padded spelling', '0169-0254-0169-0254.nip.io'],
    ['a dash host with a suffix label', '169-254-169-254.x.nip.io'],
    // IPv4-COMPATIBLE (::/96) carries the address with no `ffff` marker, so the mapped checks
    // miss it.
    ['an IPv4-compatible metadata address', '[::a9fe:a9fe]'],
    ['an IPv4-compatible dotted form', '[::169.254.169.254]'],
    // COMPRESSION can elide a zero group INSIDE the embedded address, so a positional read on
    // the raw split decodes the wrong pair or skips it. `[64:ff9b::a9fe]` is 0.0.169.254.
    ['a compression-elided NAT64 address', '[64:ff9b::a9fe]'],
    ['a compression-elided 6to4 address', '[2002:a9fe::]'],
    ['a compression-elided low group', '[64:ff9b::254]'],
    // RFC 2765 IPv4-translated puts a zero group between the marker and the address.
    ['an RFC 2765 translated address', '[::ffff:0:a9fe:a9fe]'],
    // Hex and packed-decimal spellings of the whole address, under a wildcard suffix.
    ['a hex-packed wildcard host', '0xa9fea9fe.nip.io'],
    ['a decimal-packed wildcard host', '2852039166.nip.io'],
  ])('blocks %s', (_label, hostname) => {
    expect(isPrivateHost(hostname)).toBe(true);
  });

  it.each([
    ['an ordinary CDN', 'cdn.example.com'],
    ['a public IPv4', '93.184.216.34'],
    ['a name merely containing localhost', 'notlocalhost.example.com'],
    ['a public IPv6', '[2606:2800:220:1:248:1893:25c8:1946]'],
    // Numeric LABELS are ordinary in real hostnames; only an all-numeric dotted host is a
    // malformed IP literal. Rejecting any numeric label blocked these legitimate ones.
    ['a numeric first label', '163.com'],
    ['a numeric label mid-name', 'mail.163.com'],
    ['a single-digit label', '1.gravatar.com'],
    ['a year-prefixed subdomain', '2024.events.example.com'],
    ['a public host with trailing dots', 'cdn.example.com..'],
    // A PUBLIC address in a wildcard name is not a bypass -- denying it would break a legitimate
    // use of the same service.
    ['a nip.io host for a public address', '8.8.8.8.nip.io'],
    ['dash notation for a public address', '8-8-8-8.nip.io'],
    // Hyphenated names are ordinary; only a leading dotted-quad-shaped label counts.
    ['a hyphenated hostname', 'my-cdn.example.com'],
    ['a hyphenated non-numeric label', 'a-b-c-d.example.com'],
    // The spelled-address scan is GATED to wildcard-DNS suffixes. Without that gate these
    // ordinary version and build labels were refused, silently dropping legitimate content --
    // the same failure mode this change fixes elsewhere.
    ['a version-numbered subdomain', 'release-10-0-0-5.example.com'],
    ['a build-numbered subdomain', 'build-192-168-1-1.ci.example.com'],
    ['a hex label outside a wildcard suffix', '0xa9fea9fe.example.com'],
    ['a hex-packed PUBLIC address', '0x08080808.nip.io'],
  ])('allows %s', (_label, hostname) => {
    expect(isPrivateHost(hostname)).toBe(false);
  });

  // The trailing dot is the one that actually got through review: `new URL('http://localhost./x')`
  // keeps the dot in `hostname`, which failed both the exact match and the `.localhost` suffix
  // check, while a resolver treats the two as the same absolute name.
  // Pins the STRIPPING specifically, independent of the `..` guard. Both currently catch
  // `localhost..`, so a single-dot strip still passes the block-list cases above -- verified by
  // mutation. Asserting the normalised form is what makes the strip itself load-bearing, so
  // removing either protection fails something.
  it.each([
    ['one dot', 'cdn.example.com.'],
    ['two dots', 'cdn.example.com..'],
    ['three dots', 'cdn.example.com...'],
  ])('strips %s from a PUBLIC host rather than refusing it', (_label, hostname) => {
    // A public name with trailing dots must still be allowed: if the strip were partial, the
    // leftover `..` would trip the empty-label guard and this legitimate host would be refused.
    expect(isPrivateHost(hostname)).toBe(false);
  });

  it.each([1, 2, 3, 5])('treats %i trailing root dot(s) as the same name', (count) => {
    const dots = '.'.repeat(count);
    expect(isPrivateHost(`localhost${dots}`)).toBe(isPrivateHost('localhost'));
    expect(isPrivateHost(`127.0.0.1${dots}`)).toBe(isPrivateHost('127.0.0.1'));
    expect(isPrivateHost(`169.254.169.254${dots}`)).toBe(isPrivateHost('169.254.169.254'));
  });

  // The tail FAILS CLOSED. Four separate evasions reached review because an unrecognised shape
  // returned false, so anything that is not a well-formed name or a judged IP literal is now
  // treated as private. A new spelling therefore fails safe instead of becoming bypass number five.
  it.each([
    ['a malformed octet count', '10.0.0'],
    ['a five-octet address', '10.0.0.1.5'],
    ['an underscore host', 'foo_bar'],
    ['a stray bracket', '[::1'],
  ])('refuses %s rather than allowing an unrecognised shape', (_label, hostname) => {
    expect(isPrivateHost(hostname)).toBe(true);
  });
});

describe('canonicalHttpUrl', () => {
  // ONE implementation shared by the server allow-list and the client preview. They diverged
  // three times in review — scheme-only vs host-checked, raw vs canonical, userinfo kept vs
  // stripped — and each divergence let the preview show something the draft would not contain.
  it.each([
    ['strips userinfo', 'https://user:secret@cdn.example.com/h.png', 'https://cdn.example.com/h.png'],
    ['canonicalizes a scheme-relative form', 'http:example.com/r', 'http://example.com/r'],
    ['keeps an ordinary public URL', 'https://cdn.example.com/ok.png', 'https://cdn.example.com/ok.png'],
    ['trims before parsing', '  https://cdn.example.com/ok.png  ', 'https://cdn.example.com/ok.png'],
  ])('%s', (_label, input, want) => {
    expect(canonicalHttpUrl(input)).toBe(want);
  });

  it.each([
    ['a private host', 'http://169.254.169.254/h.png'],
    ['loopback with a trailing dot', 'http://localhost./h.png'],
    ['a javascript: scheme', 'javascript:alert(1)'],
    ['a data: scheme', 'data:text/html,<script>alert(1)</script>'],
    ['whitespace only', '   '],
    ['a non-string', 42],
    ['an unparsable value', 'not-a-url'],
  ])('refuses %s', (_label, input) => {
    expect(canonicalHttpUrl(input)).toBe('');
  });

  // The embedded-quad check re-judges the address it extracts, and a bare dotted-quad matches
  // that pattern AS ITSELF -- which recursed until the stack blew. Caught locally; it would have
  // been a hang in a request handler.
  it('does not recurse on a bare dotted-quad', () => {
    expect(() => isPrivateHost('93.184.216.34')).not.toThrow();
    expect(isPrivateHost('93.184.216.34')).toBe(false);
    expect(isPrivateHost('10.0.0.1')).toBe(true);
  });
});
