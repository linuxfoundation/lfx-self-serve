// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { GW_EMBED_PROJECT_BROADCASTS_LINK, GW_EMBED_PROJECT_NEWSLETTERS_LINK, GW_EMBED_ROUTE_PREFIXES, resolveGwEmbedRoutePrefix } from './gw-embed.constants';

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
