// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isOrgSlugSegment, normalizeOrgSegment, orgLensDestinationKey, orgLensPagePath, orgUrlSegment } from './org-lens-url.utils';

const UID = '0014100000MgaAAAAA';

describe('orgUrlSegment', () => {
  it('prefers the published slug, lowercased, over the SFID', () => {
    expect(orgUrlSegment({ uid: UID, slug: 'Acme-Inc' })).toBe('acme-inc');
  });

  // DR-007 §5: a slug spelled like a page name would shadow the static route, so the address falls
  // back to the identifier form for that organization.
  it.each(['overview', 'projects', 'easycla', 'not-found'])('emits the SFID when the slug is the reserved page name %p', (slug) => {
    expect(orgUrlSegment({ uid: UID, slug })).toBe(UID);
  });

  it('falls back to the SFID when the organization has no slug, and to null when it has neither', () => {
    expect(orgUrlSegment({ uid: UID, slug: null })).toBe(UID);
    expect(orgUrlSegment({ uid: UID })).toBe(UID);
    expect(orgUrlSegment({ uid: '', slug: '  ' })).toBeNull();
    expect(orgUrlSegment(null)).toBeNull();
  });

  // The producer applies the resolver's shape rules: a slug that could reshape a joined address
  // (`/`, `?`, `#`, spaces) is not emitted, and a uid that is not an SFID is not an address at all.
  it.each(['acme/inc', 'acme?x=1', 'acme#top', 'acme inc', '-acme'])('emits the SFID when the slug %p is not slug-shaped', (slug) => {
    expect(orgUrlSegment({ uid: UID, slug })).toBe(UID);
  });

  it('yields null when the uid is not an SFID and there is no usable slug', () => {
    expect(orgUrlSegment({ uid: 'legacy-uuid-1234', slug: null })).toBeNull();
    expect(orgUrlSegment({ uid: 'legacy-uuid-1234', slug: 'acme/inc' })).toBeNull();
  });
});

describe('isOrgSlugSegment', () => {
  it('rejects reserved page names but not Object.prototype keys', () => {
    expect(isOrgSlugSegment('overview')).toBe(false);
    expect(isOrgSlugSegment('constructor')).toBe(true);
    expect(isOrgSlugSegment('acme-inc')).toBe(true);
    expect(isOrgSlugSegment('-leading-dash')).toBe(false);
  });
});

describe('normalizeOrgSegment', () => {
  it('lowercases slugs but only trims SFIDs, which are case-sensitive upstream', () => {
    expect(normalizeOrgSegment('  ACME-Inc ')).toBe('acme-inc');
    expect(normalizeOrgSegment(` ${UID} `)).toBe(UID);
  });
});

describe('orgLensPagePath', () => {
  it('keeps the addressed organization when the URL names one', () => {
    expect(orgLensPagePath(['org', 'acme-inc', 'roi'], 'overview')).toBe('/org/acme-inc/overview');
    expect(orgLensPagePath(['org', UID, 'roi', 'project-1'], 'overview')).toBe(`/org/${UID}/overview`);
  });

  it('uses the legacy page address when the URL is a bare page or outside Org Lens', () => {
    expect(orgLensPagePath(['org', 'roi'], 'overview')).toBe('/org/overview');
    expect(orgLensPagePath(['org', 'easycla', 'group-1'], 'overview')).toBe('/org/overview');
    expect(orgLensPagePath(['org'], 'overview')).toBe('/org/overview');
    expect(orgLensPagePath(['project', 'acme'], 'overview')).toBe('/org/overview');
  });
});

describe('orgLensPagePath shape rules', () => {
  // The same rules as the producer (`orgUrlSegment`): punctuation or a leading dash is not a slug.
  it.each(['acme/inc', 'acme?x=1', 'acme#top', '-acme'])(
    'falls back to the legacy page when the addressed segment %p is neither slug nor SFID shaped',
    (segment) => {
      expect(orgLensPagePath(['org', segment, 'roi'], 'overview')).toBe('/org/overview');
    }
  );

  it('keeps an SFID whatever its letter case', () => {
    expect(orgLensPagePath(['org', UID, 'roi'], 'overview')).toBe(`/org/${UID}/overview`);
  });
});

describe('orgLensDestinationKey', () => {
  it('drops the organization from an Org Lens address and leaves everything else alone', () => {
    expect(orgLensDestinationKey('/org/acme-inc/projects')).toBe('/org/projects');
    expect(orgLensDestinationKey(`/org/${UID}/projects/k8s`)).toBe('/org/projects/k8s');
    expect(orgLensDestinationKey('/org/projects')).toBe('/org/projects');
    expect(orgLensDestinationKey('/org/easycla')).toBe('/org/easycla');
    expect(orgLensDestinationKey('/org/acme-inc')).toBe('/org/acme-inc');
    expect(orgLensDestinationKey('/project/cncf/overview')).toBe('/project/cncf/overview');
  });
});
