// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Salesforce base-62 alphabet (A-Z, a-z, 0-9); order must match lfx-v2-member-service pkg/sfuuid. */
const SF_B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** "LFX_" namespace fingerprint as a big-endian uint32 (0x4C46585F) — the high 32 bits of every LFX UUID v8. */
const SF_NS32 = 0x4c46585fn;

/** Case-encoding suffix alphabet used by Salesforce 15→18 id conversion (kept local so this util stays dependency-free). */
const SF_SUFFIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

/** UUID shape (8-4-4-4-12 hex). Permissive on version — the v8 + namespace check is done after parsing. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Append the standard 3-char case-encoding suffix to produce the portable 18-char Salesforce ID. */
function sfid15To18(id15: string): string {
  if (id15.length !== 15) return id15;
  let result = id15;
  for (let group = 0; group < 3; group++) {
    let bits = 0;
    for (let j = 0; j < 5; j++) {
      const ch = id15.charCodeAt(group * 5 + j);
      if (ch >= 65 && ch <= 90) bits |= 1 << j;
    }
    result += SF_SUFFIX_CHARS[bits];
  }
  return result;
}

/**
 * Deterministically decode an LFX UUID v8 (RFC 9562) back to its embedded 18-char Salesforce ID,
 * mirroring member-service `sfuuid.FromUUID`. This is the inverse of the encoder used when the
 * b2b_org uid was minted; the sfid lives inside the uid (no I/O needed).
 *
 * Returns `null` when the input is not a syntactically valid LFX UUID v8 (wrong shape, version,
 * or namespace) — callers should then fall back to the NATS `uuid-to-sfid` lookup.
 */
export function uuidV8ToSalesforceId(uid: string | null | undefined): string | null {
  if (!uid || !UUID_SHAPE.test(uid)) return null;
  const hex = uid.replace(/-/g, '');
  const b: bigint[] = [];
  for (let i = 0; i < 16; i++) {
    b.push(BigInt(parseInt(hex.slice(i * 2, i * 2 + 2), 16)));
  }

  // Reject anything not minted by the sfuuid encoder (version 8 + "LFX_" namespace).
  if (b[6] >> 4n !== 0x8n) return null;
  const customA = (b[0] << 40n) | (b[1] << 32n) | (b[2] << 24n) | (b[3] << 16n) | (b[4] << 8n) | b[5];
  if (customA >> 16n !== SF_NS32) return null;

  const sfidHigh = customA & 0xffffn;
  const sfidMid = ((b[6] & 0x0fn) << 8n) | b[7];
  let sfidLow = (b[8] & 0x3fn) << 56n;
  for (let i = 0; i < 7; i++) {
    sfidLow |= b[9 + i] << BigInt(48 - i * 8);
  }

  let v = (sfidHigh << 74n) | (sfidMid << 62n) | sfidLow;
  const chars: string[] = [];
  for (let i = 0; i < 15; i++) {
    chars.unshift(SF_B62[Number(v % 62n)]);
    v /= 62n;
  }
  return sfid15To18(chars.join(''));
}
