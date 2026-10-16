// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { RuntimeConfig } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { isGatewazeHostSessionEnabled } from '../services/gatewaze-session.service';
import { getGwEmbedStylesheetKey } from './gw-embed.helper';
import { resolvePublishableGwSupabaseKey } from './supabase-key.helper';

/**
 * The Gatewaze admin embed's share of `RuntimeConfig` (both mounts, see `GW_EMBED_ROUTE_PREFIXES`).
 * See RuntimeConfig's doc comments for each field. Empty values mean "not configured", and the
 * outlet fails closed on them.
 */
export function buildGwRuntimeConfig(
  req: Request
): Pick<RuntimeConfig, 'gwSupabaseUrl' | 'gwSupabaseAnonKey' | 'gwEmbedUrl' | 'gwHostSession' | 'gwEmbedStylesheetKey'> {
  const hostSession = isGatewazeHostSessionEnabled();
  return {
    gwSupabaseUrl: process.env['GW_SUPABASE_URL'] || '',
    // Withheld unless it is actually publishable. This value lands in the SSR payload of every
    // page, so a service-role key pasted here would hand full RLS-bypassing database access to
    // anyone who views source. The outlet already fails closed on an empty key with a clear
    // "not configured" message, which is the right outcome for a misconfiguration.
    gwSupabaseAnonKey: resolvePublishableGwSupabaseKey(req),
    gwEmbedUrl: process.env['GW_EMBED_URL'] || '',
    // The same check that gates /api/gatewaze, so the outlet never mounts the embed on a pod whose
    // routes would answer 404. It shows its not-configured panel instead.
    gwHostSession: hostSession,
    // The outlet never mounts without host-session mode, so the key is only worked out with it on.
    gwEmbedStylesheetKey: hostSession ? resolveStylesheetKey() : '',
  };
}

/**
 * The stylesheet key, or '' when the theme layer cannot be read. A page must still render then:
 * the outlet falls back to the unkeyed stylesheet URL, and that request reports the missing theme.
 */
function resolveStylesheetKey(): string {
  try {
    return getGwEmbedStylesheetKey('build_gw_runtime_config');
  } catch {
    return '';
  }
}
