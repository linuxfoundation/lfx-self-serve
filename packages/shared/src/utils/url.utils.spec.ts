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
    // These resolve EVERYTHING to loopback without spelling an address, so the scan can never
    // match them -- listing them beside the spelled-address suffixes made them look handled
    // while leaving them open. Denied outright instead.
    ['a bare localhost-wildcard domain', 'localtest.me'],
    ['any subdomain of a localhost wildcard', 'anything.localtest.me'],
    ['the lvh.me loopback wildcard', 'foo.lvh.me'],
    // traefik.me is the same shape: a subdomain that spells no address still resolves to
    // loopback, so the spelled-address scan can never match it.
    ['a traefik.me subdomain that spells no address', 'whoami.traefik.me'],
    ['the bare traefik.me domain', 'traefik.me'],
    // BARE hex is a documented nip.io/sslip.io spelling. Without decoding it, this fell through
    // every later check and was allowed.
    ['a bare-hex packed metadata address', 'a9fea9fe.nip.io'],
    ['a bare-hex packed loopback address', '7f000001.nip.io'],
    // The documented `<prefix>-<address>` form. Decoding only WHOLE labels let this through
    // while the bare spelling was refused.
    ['an affixed packed address', 'app-c0a801fc.nip.io'],
    ['a multi-affix packed address', 'web-01-0a000803.nip.io'],
    // An all-digit label is DECIMAL even though it also matches hex; testing hex first judged
    // the wrong address entirely.
    ['an 8-digit decimal packed address', '10000000.nip.io'],
    // An ambiguous label is refused when EITHER reading is private.
    ['an ambiguous label private as decimal', '08080808.nip.io'],
    // sslip.io maps `-` to `:` for IPv6, which no IPv4 scan can reach.
    ['a dash-notation IPv6 ULA', 'fd00--1.sslip.io'],
    ['a dash-notation IPv6 loopback', '--1.sslip.io'],
    // sslip.io also takes the address as 32 bare hex digits, with no separator to key off.
    ['a 32-hex-digit IPv6 ULA', 'fd001234567890abcdef1234567890ab.sslip.io'],
    ['a 32-hex-digit IPv6 loopback', '00000000000000000000000000000001.sslip.io'],
    // An EXPANDED dash form has no `::` but is still a full address; requiring `::` refused it.
    // NO zero run in this one, deliberately: `fd00-0-0-0-0-0-0-1` is caught by the dash-QUAD
    // scan (it contains `0-0-0-0`), so it would pass even with the expanded form unhandled and
    // prove nothing.
    ['an expanded dash-notation IPv6 ULA', 'fd00-1234-5678-90ab-cdef-1234-5678-90ab.sslip.io'],
    ['an expanded dash form with a zero run', 'fd00-0-0-0-0-0-0-1.sslip.io'],
    // 8 valid hex groups, so it PARSES as IPv6 -- but the resolver maps the host to the RFC1918
    // address its first four groups spell. Excluding every IPv6-parseable label from the IPv4
    // scan let these through; the exclusion now applies only to labels whose groups cannot be
    // IPv4 octets.
    ['a dash-quad hiding inside an 8-group label', '10-0-0-1-2-3-4-5.nip.io'],
    ['link-local hiding inside an 8-group label', '169-254-169-254-1-2-3-4.nip.io'],
    ['RFC1918 hiding inside an 8-group label', '192-168-1-1-0-0-0-0.sslip.io'],
    // Zero-PADDED octets read the same to a resolver, and a hex group AFTER the quad does not
    // make the quad go away. Both slipped past a per-LABEL gate; the decision belongs to the
    // window, not the label.
    ['a zero-padded private quad in an 8-group label', '0169-0254-0169-0254-1-2-3-4.nip.io'],
    ['a private quad followed by hex groups', '10-0-0-1-dead-beef-0-0.nip.io'],
    // Exactly four groups, so this IS the address rather than interior IPv6 padding.
    ['a bare all-zero dash quad', '0-0-0-0.nip.io'],
    ['a bare this-host dash quad', '0-0-0-1.nip.io'],
    // Cloud metadata by NAME. `metadata.google.internal` resolves to 169.254.169.254 -- the
    // endpoint the link-local range already denies, reached by a spelling this function cannot
    // see because it does not resolve.
    ['the GCE metadata hostname', 'metadata.google.internal'],
    ['the short GCE metadata hostname', 'metadata.goog'],
    ['the EC2 instance-data hostname', 'instance-data'],
    ['a subdomain of a metadata hostname', 'x.metadata.google.internal'],
    // Reserved and special-use ranges: none is a legitimate hero or CTA destination, and each
    // is routable-looking enough to pass every other check.
    ['RFC5737 TEST-NET-1', '192.0.2.1'],
    ['RFC5737 TEST-NET-2', '198.51.100.1'],
    ['RFC5737 TEST-NET-3', '203.0.113.1'],
    ['RFC6890 protocol assignments', '192.0.0.1'],
    ['RFC2544 benchmarking', '198.18.0.1'],
    ['multicast', '224.0.0.1'],
    // The IPv6 twin of 224/4. No more a legitimate hero destination than the v4 form.
    ['IPv6 link-local multicast', '[ff02::1]'],
    ['IPv6 multicast, low', '[ff00::1]'],
    ['IPv6 site-local multicast', '[ff05::1:3]'],
    ['the reserved 240/4 range', '240.0.0.1'],
    ['the broadcast address', '255.255.255.255'],
    // FAILS CLOSED, deliberately. These are PUBLIC addresses (Google DNS, doc range), but their
    // expanded IPv6 zero run forms a `0.0.0.x` window and they are structurally identical to
    // `0-0-0-5-dead-beef-0-0`, which resolves into 0.0.0.0/8. Four heuristics were tried --
    // exclude by value, by range, by position, by label length -- and each admitted a private
    // quad or refused a public address. Only the resolver knows which reading applies, so the
    // guard refuses both. Refusing a wildcard-DNS host for a public v6 hero image is a rare
    // cost; admitting a private quad is SSRF.
    ['a public expanded IPv6, refused fail-closed', '2001-4860-4860-0-0-0-0-8888.sslip.io'],
    ['a public expanded IPv6 in the doc range', '2001-db8-0-0-0-0-0-1.sslip.io'],
    ['a public expanded IPv6 ending in a 1', '2600-1f18-0-0-0-0-0-1.sslip.io'],
    // `[::1]` and its expanded twin are the SAME address -- a string compare against '::1'
    // matched only the compressed spelling.
    ['a fully expanded IPv6 loopback', '[0000:0000:0000:0000:0000:0000:0000:0001]'],
    ['a fully expanded unspecified address', '[0:0:0:0:0:0:0:0]'],
    // A malformed 4-LABEL host used to skip the fail-closed check entirely, a label count the
    // attacker picks for free. Uses `$`, not `_`: underscores are LEGAL in DNS labels, so an
    // underscore host is the wrong stand-in for "malformed" and this case asserted a
    // false positive.
    ['a malformed 4-label host', 'foo$bar.a.b.com'],
    // Deprecated IPv6 site-local, alongside link-local and unique-local.
    ['an IPv6 site-local address', '[fec0::1]'],
    // All-numeric but OUT OF RANGE is a malformed literal, not a name, so it fails closed --
    // checking range while deciding "is this a quad" would have let it through.
    ['an out-of-range dotted quad', '10.0.0.256'],
    ['a wildly out-of-range quad', '999.1.1.1'],
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
    // A PUBLIC address must be allowed in EVERY spelling. The fail-closed label check
    // judges the DECODED address, not the raw host -- reading the host refused these for
    // carrying colons while 6to4 spelled the same address and passed, so one public
    // address was treated two ways depending only on its encoding.
    ['a public IPv4-mapped address', '[::ffff:8.8.8.8]'],
    ['a public IPv4-mapped address in hex', '[::ffff:808:808]'],
    ['a public IPv4-compatible address', '[::8.8.8.8]'],
    ['a public 6to4 address', '[2002:808:808::]'],
    // A bare-hex label is only decoded under a wildcard-DNS suffix -- elsewhere it is a word.
    ['a bare-hex label outside a wildcard suffix', 'a9fea9fe.example.com'],
    // 32 hex digits is only an address under a wildcard-DNS suffix; elsewhere it is a word.
    ['a 32-hex label outside a wildcard suffix', 'deadbeefdeadbeefdeadbeefdeadbeef.example.com'],
    ['a 32-hex PUBLIC address under a wildcard suffix', '20010db8000000000000000000000001.sslip.io'],
    // `5a5a5a5a` is hex-only (not all-digits), so it has ONE reading: 90.90.90.90, public.
    // `08080808` is deliberately NOT used here -- it is 8.8.8.8 as hex but 0.123.77.168 as
    // decimal, and an ambiguous label is refused if EITHER reading is private.
    ['a bare-hex PUBLIC address under a wildcard suffix', '5a5a5a5a.nip.io'],
    ['an affixed PUBLIC packed address', 'app-5a5a5a5a.nip.io'],
    // Underscores are legal in DNS labels and ordinary in internal CDN names. Denying them
    // refused real hosts without refusing a single address spelling.
    ['an underscored hostname', 'my_cdn.example.com'],
    // Neighbours of the reserved ranges, and a host merely NAMED metadata -- denying these
    // would refuse real destinations, which is the failure mode this file keeps guarding.
    ['a host next to TEST-NET-3', '203.0.114.1'],
    ['a host next to TEST-NET-2', '198.52.100.1'],
    ['a host next to the protocol range', '192.1.2.3'],
    ['the last address below multicast', '223.255.255.255'],
    // `fe00::/8` sits just below the multicast prefix and is ordinary space.
    ['an IPv6 address below the multicast prefix', '[fe00::1]'],
    ['an ordinary host named metadata', 'metadata.example.com'],
    // Quad-SHAPED but not a quad: the fourth label is a TLD, so these are ordinary hostnames.
    // Reading only the first three octets refused them as RFC1918 -- a false positive on a
    // legitimate hero or CTA URL.
    ['a hostname shaped like an RFC1918 quad', '10.0.0.com'],
    ['a hostname shaped like a 192.168 quad', '192.168.1.org'],
    ['a hostname shaped like a loopback quad', '127.0.0.io'],
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
    ['a host with an illegal character', 'foo$bar'],
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
  /**
   * sslip.io documents a `<prefix>-<address>` affix, and the IPv4 decoder strips it while the
   * IPv6 one did not -- so `app-fd00--1.sslip.io` decoded to `app:fd00::1`, failed the hex test
   * and returned "not private". An asymmetry between two decoders of the SAME notation is a
   * bypass by omission.
   *
   * Fixing the strip alone was not enough, and the second half is the part worth pinning: an
   * affixed label can decode as a valid PUBLIC address BEFORE its private reading is reached.
   * `web-01-fd00--1` yields `01:fd00::1` (public) at one split point and `fd00::1` (private) at
   * the next, so returning the first reading that decodes returns the public one and the host
   * passes. Every reading is judged now, which is the contract the IPv4 side already had.
   *
   * And a reading that BEGINS with an empty segment must be judged too: in `app---1` the
   * address's own leading `::` renders as empty segments, so skipping them hid `::1` entirely.
   */
  it.each([
    ['an affixed compressed IPv6 wildcard host', 'app-fd00--1.sslip.io'],
    ['an affix containing its own dash', 'web-01-fd00--1.sslip.io'],
    ['an affixed loopback whose address starts with ::', 'app---1.sslip.io'],
    ['an affixed link-local', 'x-fe80--1.sslip.io'],
    ['an affixed expanded form', 'app-fd00-0-0-0-0-0-0-1.sslip.io'],
    ['an affixed 32-hex packed form', 'app-fd001234567890abcdef1234567890ab.sslip.io'],
  ])('denies %s', (_label, host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  /**
   * The negative half, in the same commit as the positive half on purpose. Every previous round
   * of hardening this function created a FALSE POSITIVE -- `release-10-0-0-5.example.com` and
   * `163.com` were both refused at some point -- because the allow cases were never written
   * alongside the deny cases. Dropping a legitimate hero image is a real defect.
   */
  it.each([
    ['a PUBLIC IPv6 under a wildcard suffix', '2001-4860-4860--8888.sslip.io'],
    ['an AFFIXED public IPv6', 'app-2001-4860-4860--8888.sslip.io'],
    ['an ordinary host that merely looks like the notation', 'web-01-prod.example.com'],
    ['a hostname containing a hex-like label', 'deadbeef-cafe.example.com'],
    ['a hostname with a double dash', 'x--y.example.com'],
    ['a build label with dotted numbers', 'release-10-0-0-5.example.com'],
    // A PUBLIC address whose interface id is ::1 -- the shape review predicted the every-reading
    // scan would over-deny, by assuming it produces a bare `--1` (loopback) reading. It does not:
    // readings start at segment boundaries, so `2001-db8--1` yields `2001:db8::1` and `db8::1`,
    // both public, and the `-1`/`1` tails decode to nothing. Pinned because the claim was
    // specific and plausible, and because the allow cases previously only used `::8888`.
    ['a public IPv6 whose interface id is ::1', '2001-db8--1.sslip.io'],
    ['another public ::1 under a wildcard suffix', '2606-4700--1.sslip.io'],
    ['a public ::1 with a longer prefix', '2a00-1450-4001--1.sslip.io'],
  ])('allows %s', (_label, host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
  /**
   * The SAME address in compressed and fully-expanded form must get the same verdict.
   *
   * `isCompatHex` ended with `addr.startsWith('::')`, a test on the RAW string, which defeated
   * the `expandIPv6` normalisation performed three lines above it: the fully-expanded metadata
   * endpoint `0:0:0:0:0:0:a9fe:a9fe` satisfied every other condition and was then refused by a
   * text test it cannot pass, while `::a9fe:a9fe` -- the identical address -- was blocked.
   *
   * Normalise before matching is the rule this file's docstring states; the raw-string clause
   * was the one place that broke it.
   */
  it.each([
    ['IPv4-compatible metadata endpoint', '::a9fe:a9fe', '0:0:0:0:0:0:a9fe:a9fe'],
    ['IPv4-compatible RFC1918', '::0a00:0001', '0:0:0:0:0:0:0a00:0001'],
    ['IPv4-mapped metadata endpoint', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:a9fe:a9fe'],
    ['loopback', '::1', '0:0:0:0:0:0:0:1'],
  ])('denies %s in both compressed and expanded form', (_label, compressed, expanded) => {
    expect(isPrivateHost(compressed)).toBe(true);
    expect(isPrivateHost(expanded)).toBe(true);
    expect(isPrivateHost(`[${expanded}]`)).toBe(true);
  });

  it.each([
    ['IPv4-mapped public address', '::ffff:8.8.8.8', '0:0:0:0:0:ffff:808:808'],
    ['ordinary public IPv6', '2001:4860:4860::8888', '2001:4860:4860:0:0:0:0:8888'],
  ])('allows %s in both compressed and expanded form', (_label, compressed, expanded) => {
    expect(isPrivateHost(compressed)).toBe(false);
    expect(isPrivateHost(expanded)).toBe(false);
    expect(isPrivateHost(`[${expanded}]`)).toBe(false);
  });
});
