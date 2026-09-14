// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  GW_EMBED_DEFAULT_TEMPLATE_COLLECTION,
  GW_EMBED_PROJECT_BROADCASTS_LINK,
  GW_EMBED_PROJECT_NEWSLETTERS_LINK,
  GW_EMBED_ROUTE_PREFIXES,
  GW_EMBED_TEMPLATE_COLLECTION_BY_SLUG,
  resolveGwEmbedRoutePrefix,
  resolveGwEmbedTemplateCollection,
} from './gw-embed.constants';

/**
 * The cascade decides which brand's template a newsletter publishes with, so getting it wrong is
 * visible to subscribers rather than to a developer. These pin the precedence and, more
 * importantly, the fallbacks — an unmapped scope must land on the generic template, never on
 * whichever brand happens to be first in the map.
 */
describe('resolveGwEmbedTemplateCollection', () => {
  it("uses the project's own collection when it has one", () => {
    expect(resolveGwEmbedTemplateCollection('agentic-ai-foundation', undefined)).toBe('usercommunity');
  });

  it("inherits the foundation's collection when the project names none", () => {
    expect(resolveGwEmbedTemplateCollection('some-unmapped-project', 'agentic-ai-foundation')).toBe('usercommunity');
  });

  it('prefers the project over its foundation when both are mapped', () => {
    // Guards the precedence half of "a project may publish its own newsletter with its own
    // template": a foundation mapping must never override a project that has its own.
    const [projectSlug] = Object.keys(GW_EMBED_TEMPLATE_COLLECTION_BY_SLUG);
    expect(resolveGwEmbedTemplateCollection(projectSlug, 'agentic-ai-foundation')).toBe(GW_EMBED_TEMPLATE_COLLECTION_BY_SLUG[projectSlug]);
  });

  it('falls back to the default collection when neither is mapped', () => {
    expect(resolveGwEmbedTemplateCollection('unknown-project', 'unknown-foundation')).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
  });

  it('falls back to the default when no scope is known at all', () => {
    // Foundation-lens mounts pass no project slug; a mount before context resolves passes neither.
    expect(resolveGwEmbedTemplateCollection(undefined, undefined)).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
    expect(resolveGwEmbedTemplateCollection(null, null)).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
  });

  it('does not match a slug approximately', () => {
    // Slugs come from LFX's own project records, so a near-miss is a mapping bug — it must fall
    // through to the default rather than be guessed into someone else's brand.
    expect(resolveGwEmbedTemplateCollection('agentic-ai-foundation-2', undefined)).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
    expect(resolveGwEmbedTemplateCollection('AGENTIC-AI-FOUNDATION', undefined)).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
  });

  it('never resolves to an empty collection', () => {
    // The embed treats this as a preference and falls back on an unknown value, but an empty
    // string would read as "explicitly none" rather than "unmapped".
    for (const slug of [undefined, null, '', 'unknown', ...Object.keys(GW_EMBED_TEMPLATE_COLLECTION_BY_SLUG)]) {
      expect(resolveGwEmbedTemplateCollection(slug, undefined)).toBeTruthy();
    }
  });
});

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
    // These are what the Project Lens links to; if they ever fell outside the prefix list the
    // outlet would resolve the wrong basename and the embed's router would build broken links.
    expect(resolveGwEmbedRoutePrefix(GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBe('/project/gw');
    expect(resolveGwEmbedRoutePrefix(GW_EMBED_PROJECT_BROADCASTS_LINK)).toBe('/project/gw');
  });
});
