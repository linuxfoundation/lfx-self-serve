// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { GW_EMBED_PROJECT_NEWSLETTERS_LINK, GW_EMBED_ROUTE_PREFIXES } from '../constants/gw-embed.constants';
import { isGwEmbedAllowedForSlug, resolveGwEmbedRoutePrefix } from './gw-embed.utils';

describe('resolveGwEmbedRoutePrefix', () => {
  it('resolves each mount from its own pathname', () => {
    expect(resolveGwEmbedRoutePrefix('/project/gw/newsletters')).toBe('/project/gw');
    expect(resolveGwEmbedRoutePrefix('/foundation/gw/newsletters')).toBe('/foundation/gw');
  });

  it('falls back to the first prefix for a pathname under neither mount', () => {
    expect(resolveGwEmbedRoutePrefix('/somewhere/else')).toBe(GW_EMBED_ROUTE_PREFIXES[0]);
    expect(resolveGwEmbedRoutePrefix('')).toBe(GW_EMBED_ROUTE_PREFIXES[0]);
  });

  it('does not swallow a sibling path that merely starts with a prefix', () => {
    // The anchoring this function's comment calls load-bearing had no test: the existing cases pin
    // the real mounts and the generic fallback, both of which a bare `startsWith` also satisfies.
    //
    // `/project/gwidgets` is the near-miss that actually separates the two. A bare `startsWith`
    // resolves it to `/project/gw` and the embed would build every link under the wrong mount;
    // anchored, it matches no prefix and falls back. `/foundation/gwidgets` cannot show this —
    // both implementations return `/foundation/gw`, one by matching and one by fallback.
    expect(resolveGwEmbedRoutePrefix('/project/gwidgets')).toBe(GW_EMBED_ROUTE_PREFIXES[0]);
    expect(resolveGwEmbedRoutePrefix('/project/gwidgets')).not.toBe('/project/gw');
  });

  it('matches a prefix exactly, with or without a trailing segment', () => {
    // The two halves of the anchor. Dropping `pathname === prefix` would send a bare mount to the
    // fallback, which on /project/gw is the wrong lens entirely.
    expect(resolveGwEmbedRoutePrefix('/project/gw')).toBe('/project/gw');
    expect(resolveGwEmbedRoutePrefix('/project/gw/')).toBe('/project/gw');
  });

  it('keeps the sidebar links inside a declared prefix', () => {
    // If either fell outside the prefix list the outlet would resolve the wrong basename and the
    // embed's router would build broken links under it.
    expect(resolveGwEmbedRoutePrefix(GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBe('/project/gw');
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
