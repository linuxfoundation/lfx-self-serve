// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_EASYCLA_PATH, ORG_ROLLUP_SEGMENT } from '../constants';
import {
  isOrgRollUpSegment,
  isOrgSlugSegment,
  legacyOrgEasyclaReturnPath,
  normalizeOrgSegment,
  orgEasyclaReturnPath,
  orgLensDestinationKey,
  orgLensPagePath,
  orgUrlSegment,
} from './org-lens-url.utils';

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

  // The resolver classifies SFID syntax before slugs, so a slug that looks like an SFID would be
  // resolved as an account id — of some other organization, or none. The real SFID is used instead.
  it('emits the SFID when the published slug is itself SFID-shaped', () => {
    expect(orgUrlSegment({ uid: UID, slug: '0014100000mgbbbbbb' })).toBe(UID);
    expect(isOrgSlugSegment('0014100000mgbbbbbb')).toBe(false);
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

  // The segment is passed through as addressed: SFIDs are case-sensitive upstream, and a slug's
  // case is the path-param guard's to canonicalize on the next navigation, not this builder's.
  it('passes the addressed segment through unchanged, whatever its letter case', () => {
    const mixed = '0014100000MgAaAaAa';
    expect(orgLensPagePath(['org', mixed, 'roi'], 'overview')).toBe(`/org/${mixed}/overview`);
    expect(orgLensPagePath(['org', 'ACME-Inc', 'roi'], 'overview')).toBe('/org/ACME-Inc/overview');
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

describe('orgEasyclaReturnPath', () => {
  it('addresses the CLA Group under the organization, as the /org/:orgSegment/easycla/:claGroupId route expects', () => {
    expect(orgEasyclaReturnPath('0014100000Te2ovAAB', 'cla-group-uuid-1')).toBe('/org/0014100000Te2ovAAB/easycla/cla-group-uuid-1');
  });

  // Both values reach the address as single path segments whatever they hold.
  it('encodes both segments', () => {
    expect(orgEasyclaReturnPath('a/b', 'c?d')).toBe('/org/a%2Fb/easycla/c%3Fd');
  });

  it('is the leftover address plus the organization segment', () => {
    expect(ORG_EASYCLA_PATH).toBe('/org/easycla');
    expect(orgEasyclaReturnPath('0014100000Te2ovAAB', 'g')).toBe('/org/0014100000Te2ovAAB/easycla/g');
  });
});

describe('legacyOrgEasyclaReturnPath', () => {
  it('builds the leftover shape under the legacy mount, with no organization in the path', () => {
    expect(legacyOrgEasyclaReturnPath('c1ab2e7d-0000-4000-8000-000000000001')).toBe('/org/easycla/c1ab2e7d-0000-4000-8000-000000000001');
  });

  it('encodes the CLA Group id so it cannot append a segment', () => {
    expect(legacyOrgEasyclaReturnPath('g/../x?y')).toBe('/org/easycla/g%2F..%2Fx%3Fy');
  });
});

// lfx-self-serve#4125 — the All Organizations roll-up segment. It is an address for a *set*, so it
// must travel like an organization segment through every builder while never being mistaken for a
// slug the resolver could look up.
describe('All Organizations roll-up segment', () => {
  it('recognises only the reserved value', () => {
    expect(isOrgRollUpSegment(ORG_ROLLUP_SEGMENT)).toBe(true);
    expect(isOrgRollUpSegment('all')).toBe(true);
    expect(isOrgRollUpSegment('All')).toBe(false);
    expect(isOrgRollUpSegment('all-hands')).toBe(false);
    expect(isOrgRollUpSegment(UID)).toBe(false);
    expect(isOrgRollUpSegment(undefined)).toBe(false);
    expect(isOrgRollUpSegment(null)).toBe(false);
  });

  // The resolver would answer "no such organization" for it, so it must never be offered one.
  it('is not a slug segment', () => {
    expect(isOrgSlugSegment(ORG_ROLLUP_SEGMENT)).toBe(false);
  });

  // An organization whose indexed slug really is `all` is addressed by its SFID — the same fallback
  // a reserved page name already gets (DR-007 §5), so the sentinel can never be ambiguous.
  it('is reserved against a real organization claiming it as a slug', () => {
    expect(orgUrlSegment({ uid: UID, slug: ORG_ROLLUP_SEGMENT })).toBe(UID);
  });

  it('is the address of the roll-up selection itself, whatever slug it carries', () => {
    expect(orgUrlSegment({ uid: ORG_ROLLUP_SEGMENT, slug: null })).toBe(ORG_ROLLUP_SEGMENT);
    expect(orgUrlSegment({ uid: ORG_ROLLUP_SEGMENT, slug: 'ignored' })).toBe(ORG_ROLLUP_SEGMENT);
  });

  // A feature fallback redirecting inside `/org/all/…` must keep the roll-up rather than dropping
  // the viewer back to the legacy `/org/{page}` form under their cookie selection.
  it('survives a page-path rebuild', () => {
    expect(orgLensPagePath(['org', ORG_ROLLUP_SEGMENT, 'people'], 'contributions')).toBe('/org/all/contributions');
  });

  // The sidebar tracks rows by destination; the roll-up is an organization, so it is stripped the
  // same way a slug or SFID is. Deliberately NOT page-listed — that would break this.
  it('is stripped from the destination key like any other organization segment', () => {
    expect(orgLensDestinationKey('/org/all/people')).toBe('/org/people');
  });
});
