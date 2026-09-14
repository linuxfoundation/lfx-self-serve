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
 * visible to subscribers rather than to a developer. These pin the precedence and the fallbacks:
 * an unmapped or unrelated scope must land on the generic collection, never on whichever brand
 * happens to be nearby.
 *
 * Precedence and inheritance are exercised against a two-entry fixture rather than the live
 * mapping. The real map has one entry today, so asserting against it would pass even if the
 * cascade were reordered — the rule would be untested precisely where it matters.
 */
describe('resolveGwEmbedTemplateCollection', () => {
  const FIXTURE = { 'a-project': 'project-collection', 'a-foundation': 'foundation-collection' };

  describe('precedence', () => {
    it("prefers the project's own collection over its foundation's", () => {
      expect(resolveGwEmbedTemplateCollection({ projectSlug: 'a-project', foundationSlug: 'a-foundation', foundationIsParentOfProject: true }, FIXTURE)).toBe(
        'project-collection'
      );
    });

    it("inherits the foundation's collection when the project has none of its own", () => {
      expect(
        resolveGwEmbedTemplateCollection({ projectSlug: 'unmapped-project', foundationSlug: 'a-foundation', foundationIsParentOfProject: true }, FIXTURE)
      ).toBe('foundation-collection');
    });

    it('uses the foundation directly when no project is in scope', () => {
      expect(resolveGwEmbedTemplateCollection({ foundationSlug: 'a-foundation' }, FIXTURE)).toBe('foundation-collection');
    });
  });

  describe('cross-brand guards', () => {
    it('does not inherit from a foundation that is not the project parent', () => {
      // The host holds project and foundation in independent slots, so they can describe unrelated
      // scopes. Inheriting there would publish an unmapped project under someone else's brand.
      expect(
        resolveGwEmbedTemplateCollection({ projectSlug: 'unmapped-project', foundationSlug: 'a-foundation', foundationIsParentOfProject: false }, FIXTURE)
      ).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
    });

    it('treats an unspecified parent relationship as unrelated', () => {
      // Absent evidence, fail safe: an omitted flag must not be read as "related".
      expect(resolveGwEmbedTemplateCollection({ projectSlug: 'unmapped-project', foundationSlug: 'a-foundation' }, FIXTURE)).toBe(
        GW_EMBED_DEFAULT_TEMPLATE_COLLECTION
      );
    });

    it('still honours a mapped project regardless of the foundation it is paired with', () => {
      expect(
        resolveGwEmbedTemplateCollection({ projectSlug: 'a-project', foundationSlug: 'unrelated-foundation', foundationIsParentOfProject: false }, FIXTURE)
      ).toBe('project-collection');
    });
  });

  describe('fallbacks', () => {
    it('falls back to the default when nothing is mapped', () => {
      expect(resolveGwEmbedTemplateCollection({ projectSlug: 'unknown', foundationSlug: 'also-unknown' }, FIXTURE)).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
    });

    it('falls back to the default when no scope is known at all', () => {
      // A mount before context resolves passes neither.
      expect(resolveGwEmbedTemplateCollection({}, FIXTURE)).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
      expect(resolveGwEmbedTemplateCollection({ projectSlug: null, foundationSlug: null }, FIXTURE)).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
    });

    it('does not match a slug approximately', () => {
      expect(resolveGwEmbedTemplateCollection({ projectSlug: 'a-project-2' }, FIXTURE)).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
      expect(resolveGwEmbedTemplateCollection({ projectSlug: 'A-PROJECT' }, FIXTURE)).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
    });

    it('ignores inherited object properties', () => {
      // A prototype-chain hit would return a function here rather than falling through — truthy,
      // so it would sail past a "resolves to something" assertion and reach the embed as garbage.
      for (const slug of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
        expect(resolveGwEmbedTemplateCollection({ projectSlug: slug }, FIXTURE)).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
      }
    });
  });

  describe('the live mapping', () => {
    it('resolves every configured slug to a non-empty collection', () => {
      // Against the real map, not the fixture — a typo'd value would otherwise only surface in
      // production as a missing template.
      for (const slug of Object.keys(GW_EMBED_TEMPLATE_COLLECTION_BY_SLUG)) {
        const resolved = resolveGwEmbedTemplateCollection({ projectSlug: slug });
        expect(resolved).toBe(GW_EMBED_TEMPLATE_COLLECTION_BY_SLUG[slug]);
        expect(resolved).toBeTruthy();
      }
    });

    it('gives an unmapped scope the default rather than a configured brand', () => {
      const configured = Object.values(GW_EMBED_TEMPLATE_COLLECTION_BY_SLUG);
      const resolved = resolveGwEmbedTemplateCollection({ projectSlug: 'not-in-the-map', foundationSlug: 'also-not' });

      expect(resolved).toBe(GW_EMBED_DEFAULT_TEMPLATE_COLLECTION);
      expect(configured).not.toContain(resolved);
    });
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
    // If these fell outside the prefix list the outlet would resolve the wrong basename and the
    // embed's router would build broken links.
    expect(resolveGwEmbedRoutePrefix(GW_EMBED_PROJECT_NEWSLETTERS_LINK)).toBe('/project/gw');
    expect(resolveGwEmbedRoutePrefix(GW_EMBED_PROJECT_BROADCASTS_LINK)).toBe('/project/gw');
  });
});
