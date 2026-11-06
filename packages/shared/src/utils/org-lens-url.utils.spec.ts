// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_EASYCLA_PATH } from '../constants';
import {
  companyLensRedirectTarget,
  easyclaReturnOrgParam,
  isOrgSlugSegment,
  legacyDocsRedirectTarget,
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
    expect(orgLensPagePath(['company', 'acme-inc', 'roi'], 'overview')).toBe('/company/acme-inc/overview');
    expect(orgLensPagePath(['company', UID, 'roi', 'project-1'], 'overview')).toBe(`/company/${UID}/overview`);
  });

  it('uses the legacy page address when the URL is a bare page or outside Org Lens', () => {
    expect(orgLensPagePath(['company', 'roi'], 'overview')).toBe('/company/overview');
    expect(orgLensPagePath(['company', 'easycla', 'group-1'], 'overview')).toBe('/company/overview');
    expect(orgLensPagePath(['company'], 'overview')).toBe('/company/overview');
    expect(orgLensPagePath(['project', 'acme'], 'overview')).toBe('/company/overview');
  });
});

describe('orgLensPagePath shape rules', () => {
  // The same rules as the producer (`orgUrlSegment`): punctuation or a leading dash is not a slug.
  it.each(['acme/inc', 'acme?x=1', 'acme#top', '-acme'])(
    'falls back to the legacy page when the addressed segment %p is neither slug nor SFID shaped',
    (segment) => {
      expect(orgLensPagePath(['company', segment, 'roi'], 'overview')).toBe('/company/overview');
    }
  );

  // The segment is passed through as addressed: SFIDs are case-sensitive upstream, and a slug's
  // case is the path-param guard's to canonicalize on the next navigation, not this builder's.
  it('passes the addressed segment through unchanged, whatever its letter case', () => {
    const mixed = '0014100000MgAaAaAa';
    expect(orgLensPagePath(['company', mixed, 'roi'], 'overview')).toBe(`/company/${mixed}/overview`);
    expect(orgLensPagePath(['company', 'ACME-Inc', 'roi'], 'overview')).toBe('/company/ACME-Inc/overview');
  });
});

describe('orgLensDestinationKey', () => {
  it('drops the organization from an Org Lens address and leaves everything else alone', () => {
    expect(orgLensDestinationKey('/company/acme-inc/projects')).toBe('/company/projects');
    expect(orgLensDestinationKey(`/company/${UID}/projects/k8s`)).toBe('/company/projects/k8s');
    expect(orgLensDestinationKey('/company/projects')).toBe('/company/projects');
    expect(orgLensDestinationKey('/company/easycla')).toBe('/company/easycla');
    expect(orgLensDestinationKey('/company/acme-inc')).toBe('/company/acme-inc');
    expect(orgLensDestinationKey('/project/cncf/overview')).toBe('/project/cncf/overview');
  });
});

describe('orgEasyclaReturnPath', () => {
  it('addresses the CLA Group under the organization, as the /company/:orgSegment/easycla/:claGroupId route expects', () => {
    expect(orgEasyclaReturnPath('0014100000Te2ovAAB', 'cla-group-uuid-1')).toBe('/company/0014100000Te2ovAAB/easycla/cla-group-uuid-1');
  });

  // Both values reach the address as single path segments whatever they hold.
  it('encodes both segments', () => {
    expect(orgEasyclaReturnPath('a/b', 'c?d')).toBe('/company/a%2Fb/easycla/c%3Fd');
  });

  it('is the leftover address plus the organization segment', () => {
    expect(ORG_EASYCLA_PATH).toBe('/company/easycla');
    expect(orgEasyclaReturnPath('0014100000Te2ovAAB', 'g')).toBe('/company/0014100000Te2ovAAB/easycla/g');
  });
});

describe('legacyOrgEasyclaReturnPath', () => {
  it('builds the leftover shape under the legacy mount, with no organization in the path', () => {
    expect(legacyOrgEasyclaReturnPath('c1ab2e7d-0000-4000-8000-000000000001')).toBe('/company/easycla/c1ab2e7d-0000-4000-8000-000000000001');
  });

  it('encodes the CLA Group id so it cannot append a segment', () => {
    expect(legacyOrgEasyclaReturnPath('g/../x?y')).toBe('/company/easycla/g%2F..%2Fx%3Fy');
  });
});

describe('companyLensRedirectTarget', () => {
  it.each([
    ['/org', '/company'],
    ['/org/', '/company/'],
    ['/org/not-found', '/company/not-found'],
    ['/org/acme-inc/projects', '/company/acme-inc/projects'],
    [`/org/${UID}/memberships/linux-foundation`, `/company/${UID}/memberships/linux-foundation`],
    ['/org/overview', '/company/overview'],
    ['/org/projects/uepf', '/company/projects/uepf'],
  ])('moves %s to %s', (from, to) => {
    expect(companyLensRedirectTarget(from)).toBe(to);
  });

  it('keeps the query string verbatim', () => {
    expect(companyLensRedirectTarget('/org/acme/people?employees=a%20b&tab=board')).toBe('/company/acme/people?employees=a%20b&tab=board');
    expect(companyLensRedirectTarget('/org?x=1')).toBe('/company?x=1');
  });

  it('renames the pre-rename EasyCLA return parameter on both EasyCLA mounts', () => {
    expect(companyLensRedirectTarget('/org/easycla/g1?org=001A&signed=1')).toBe('/company/easycla/g1?company=001A&signed=1');
    expect(companyLensRedirectTarget('/org/acme/easycla/g1?signed=1&org=001A')).toBe('/company/acme/easycla/g1?signed=1&company=001A');
  });

  it('leaves ?org= alone off EasyCLA, and lets an existing ?company= win', () => {
    expect(companyLensRedirectTarget('/org/acme/projects?org=x')).toBe('/company/acme/projects?org=x');
    expect(companyLensRedirectTarget('/org/easycla/g1?org=old&company=new')).toBe('/company/easycla/g1?company=new');
  });

  it.each(['/', '/organization', '/orgs', '/org-x', '/api/orgs/x', '/company/overview', '//org/overview', '/docs/org'])('does not match %s', (path) => {
    expect(companyLensRedirectTarget(path)).toBeNull();
  });
});

describe('easyclaReturnOrgParam', () => {
  it('prefers ?company= and falls back to the pre-rename ?org=', () => {
    expect(easyclaReturnOrgParam((n) => ({ company: 'A', org: 'B' })[n as 'company'])).toBe('A');
    expect(easyclaReturnOrgParam((n) => ({ org: 'B' })[n as 'org'] ?? null)).toBe('B');
    expect(easyclaReturnOrgParam(() => null)).toBeNull();
  });
});

describe('legacyDocsRedirectTarget', () => {
  it.each([
    ['/docs/organization', '/docs/company'],
    ['/docs/organization/choose-an-organization', '/docs/company/choose-a-company'],
    ['/docs/organization/org-overview', '/docs/company/company-overview'],
    ['/docs/organization/memberships', '/docs/company/memberships'],
    ['/docs/organization/easycla', '/docs/company/easycla'],
    ['/docs/organization/manage-org-lens-access', '/docs/company/manage-company-lens-access'],
    ['/docs/organization/org-events', '/docs/company/company-events'],
    ['/docs/organization/org-profile', '/docs/company/company-profile'],
    ['/docs/organization/people', '/docs/company/people'],
    ['/docs/organization/faq', '/docs/company/faq'],
    ['/docs/dashboards/organization-involvement', '/docs/dashboards/company-involvement'],
    ['/docs/organization/projects', '/docs/company/projects'],
    ['/docs/organization/easycla?x=1', '/docs/company/easycla?x=1'],
  ])('moves %s to %s', (from, to) => {
    expect(legacyDocsRedirectTarget(from)).toBe(to);
  });

  it.each(['/docs', '/docs/company/faq', '/docs/organizations', '/organization'])('does not match %s', (path) => {
    expect(legacyDocsRedirectTarget(path)).toBeNull();
  });
});
