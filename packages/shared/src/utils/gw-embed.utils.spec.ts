// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { GW_EMBED_PROJECT_BROADCASTS_LINK, GW_EMBED_PROJECT_NEWSLETTERS_LINK, GW_EMBED_ROUTE_PREFIXES } from '../constants/gw-embed.constants';
import { GW_EMBED_STORAGE_KEY_SUFFIX } from '../constants/gw-embed.constants';
import { buildGwEmbedStorageSuffix, isGwEmbedAllowedForSlug, resolveGwEmbedRoutePrefix } from './gw-embed.utils';

describe('resolveGwEmbedRoutePrefix', () => {
  it('resolves each mount from its own pathname', () => {
    expect(resolveGwEmbedRoutePrefix('/project/gw/newsletters')).toBe('/project/gw');
    expect(resolveGwEmbedRoutePrefix('/foundation/gw/newsletters')).toBe('/foundation/gw');
  });

  it('falls back to the first prefix for a pathname under neither mount', () => {
    expect(resolveGwEmbedRoutePrefix('/somewhere/else')).toBe(GW_EMBED_ROUTE_PREFIXES[0]);
    expect(resolveGwEmbedRoutePrefix('')).toBe(GW_EMBED_ROUTE_PREFIXES[0]);
  });

  it('keeps the sidebar links inside a declared prefix', () => {
    // If either fell outside the prefix list the outlet would resolve the wrong basename and the
    // embed's router would build broken links under it.
    expect(resolveGwEmbedRoutePrefix(GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBe('/project/gw');
    expect(resolveGwEmbedRoutePrefix(GW_EMBED_PROJECT_BROADCASTS_LINK)).toBe('/project/gw');
  });
});

describe('isGwEmbedAllowedForSlug', () => {
  it('admits the one tenant Gatewaze can currently serve', () => {
    expect(isGwEmbedAllowedForSlug('agentic-ai-foundation')).toBe(true);
  });

  it.each([
    ['another foundation', 'tlf'],
    ['a near-miss', 'agentic-ai-foundation-2'],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s', (_label, slug) => {
    // Fails closed on an absent slug: not knowing the tenant is exactly the case that would
    // render AAIF's newsletters under someone else's chrome.
    expect(isGwEmbedAllowedForSlug(slug)).toBe(false);
  });
});

describe('buildGwEmbedStorageSuffix', () => {
  // The key used to be a browser-wide constant, so a Gatewaze session stored for one LFX user
  // survived LFX logout and was picked up verbatim by the next user on that browser —
  // hasUsableStoredSession() checks only token and expiry, and the email comparison runs only for
  // a fragment arriving from a sign-in, never for a session already in storage.
  it('gives two identities different suffixes', () => {
    expect(buildGwEmbedStorageSuffix('auth0|alice')).not.toBe(buildGwEmbedStorageSuffix('auth0|bob'));
  });

  it('is stable for one identity, so a reload finds its own session', () => {
    expect(buildGwEmbedStorageSuffix('auth0|alice')).toBe(buildGwEmbedStorageSuffix('auth0|alice'));
  });

  it('keeps the shared prefix so the embed still namespaces against a standalone Gatewaze session', () => {
    expect(buildGwEmbedStorageSuffix('auth0|alice').startsWith(GW_EMBED_STORAGE_KEY_SUFFIX)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
  ])('falls back to the bare constant for %s, the unauthenticated case', (_label, subject) => {
    // No identity means no session worth protecting, and the embed still needs a usable key.
    expect(buildGwEmbedStorageSuffix(subject)).toBe(GW_EMBED_STORAGE_KEY_SUFFIX);
  });

  it('does not put the raw subject in the key, which any script on the origin can read', () => {
    expect(buildGwEmbedStorageSuffix('auth0|alice')).not.toContain('alice');
  });
});
