// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SUPABASE_SECRET_KEY_PREFIX, SUPABASE_SERVICE_ROLE } from '@lfx-one/shared/constants';

/**
 * Decides whether a Supabase key is safe to publish to the browser.
 *
 * `GW_SUPABASE_ANON_KEY` is serialized into `RuntimeConfig` and therefore into the SSR payload of
 * every page, where any visitor can read it. That is correct for an anon key — it is publishable by
 * design and the database is protected by RLS behind it — and catastrophic for a service-role key,
 * which bypasses RLS entirely. Nothing but the variable's NAME stood between those two outcomes,
 * and an operator pasting the wrong value out of the Supabase dashboard is an ordinary mistake with
 * no feedback: the app would work perfectly, having published full database access to the internet.
 *
 * So this fails closed instead. Both of Supabase's privileged key forms are recognised:
 *
 * - The legacy form is a JWT whose payload carries `"role": "service_role"`. Read by decoding the
 *   claims, NOT by string-matching the whole token — `service_role` can appear incidentally in a
 *   base64 blob, and matching on that would reject valid anon keys at random.
 * - The current form is an opaque `sb_secret_…` string with no claims to read.
 *
 * Deliberately a denylist of the two known-privileged shapes rather than an allowlist of valid anon
 * keys: Supabase has changed its key formats once already, and an allowlist would reject a future
 * publishable format outright — turning a working deployment off for a key that was never unsafe.
 * A denylist degrades the other way, which is the right direction for a check whose false positive
 * is an outage and whose false negative leaves the status quo.
 *
 * The signature is not verified. This is a configuration sanity check, not authentication — the
 * question is "did an operator paste the wrong kind of key", and for that the unverified claim is
 * exactly as good as a verified one.
 */
export function isPublishableSupabaseKey(key: string): boolean {
  if (!key) {
    return false;
  }

  if (key.startsWith(SUPABASE_SECRET_KEY_PREFIX)) {
    return false;
  }

  const parts = key.split('.');
  if (parts.length !== 3) {
    // Not a JWT. Every non-legacy publishable key reaches here, so this must not reject on shape
    // alone — the `sb_secret_` check above is what covers the modern privileged form.
    return true;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown };
    return payload.role !== SUPABASE_SERVICE_ROLE;
  } catch {
    // Undecodable claims: not a key shape we can vouch for, and this value is about to be handed
    // to every browser that loads the page. Withhold it.
    return false;
  }
}
