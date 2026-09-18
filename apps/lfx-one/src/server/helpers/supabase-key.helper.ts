// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SUPABASE_SECRET_KEY_PREFIX, SUPABASE_SERVICE_ROLE } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { logger } from '../services/logger.service';

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
 * Input is trimmed before classification; see the note in the body.
 *
 * The signature is not verified. This is a configuration sanity check, not authentication — the
 * question is "did an operator paste the wrong kind of key", and for that the unverified claim is
 * exactly as good as a verified one.
 */
export function isPublishableSupabaseKey(key: string): boolean {
  // Trimmed before anything else. A secret copied out of the dashboard with a leading space misses
  // the prefix check below, falls through as an unrecognised format, and gets published — while
  // whatever consumes it downstream may well trim the whitespace back off and use it. A guard that
  // ordinary copy-paste whitespace walks past is not a guard.
  const candidate = key.trim();

  if (!candidate) {
    return false;
  }

  if (candidate.startsWith(SUPABASE_SECRET_KEY_PREFIX)) {
    return false;
  }

  const parts = candidate.split('.');
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

/**
 * The last rejected key, so the warning below fires once per distinct bad value.
 *
 * Module-level mutable state in a helper, which `docs/architecture/backend/server-helpers.md`
 * allows only as a named exception — this is the second, alongside `root-project.helper.ts`'s TTL
 * cache. It qualifies on the same terms: process-wide configuration state, not per-request or
 * per-entity data, and paired with a test reset hook so specs stay isolated.
 */
let lastRejectedGwSupabaseKey: string | null = null;

/** Resets the warn-dedup memo so each spec case is the first. Test-only; never call in production. */
export function resetGwSupabaseKeyWarnMemoForTests(): void {
  lastRejectedGwSupabaseKey = null;
}

/**
 * Returns `GW_SUPABASE_ANON_KEY` only when it is safe to publish, and logs loudly when it is not.
 *
 * See `isPublishableSupabaseKey` for why this check exists. Withholding rather than throwing is
 * deliberate: this runs per SSR request on the path that renders every page, so refusing to boot
 * or 500-ing would take the whole application down over one misconfigured pilot value. The embed
 * is the only consumer and it already fails closed on an empty key with a message naming the
 * variable, so the blast radius stays inside the feature that is actually misconfigured.
 *
 * Lives beside `isPublishableSupabaseKey` rather than in `server.ts` so it is reachable by a spec.
 * The classifier had thirteen tests while this wrapper — which owns the trim-before-classify, the
 * withhold, and the warn dedup — had none, and its stated failure mode is a published service-role
 * key.
 *
 * @param req - The SSR request, used for log correlation and the `path` field on the warning.
 */
export function resolvePublishableGwSupabaseKey(req: Request): string {
  // Trimmed here too, so the value that is classified is the value that gets published — otherwise
  // the guard inspects one string and the browser receives another.
  const key = (process.env['GW_SUPABASE_ANON_KEY'] || '').trim();
  if (!key || isPublishableSupabaseKey(key)) {
    return key;
  }

  // WARN rather than DEBUG: this is a live credential-exposure attempt that has been stopped, and
  // whoever set the value needs to find out from the logs rather than from a report. The key
  // itself is never logged.
  //
  // Once per distinct bad value, not once per request. This runs inside the catch-all that renders
  // EVERY page, so an unguarded warning emits a line per page render for as long as the misconfig
  // stands — burying the one line an operator needs under thousands of identical copies, on the
  // deployment that is already broken. Keyed on the value so a second bad key still reports.
  if (lastRejectedGwSupabaseKey !== key) {
    lastRejectedGwSupabaseKey = key;
    logger.warning(req, 'gw_runtime_config', 'Refusing to publish GW_SUPABASE_ANON_KEY: it looks like a service-role/secret key, not a publishable anon key', {
      path: req.path,
    });
  }
  return '';
}
