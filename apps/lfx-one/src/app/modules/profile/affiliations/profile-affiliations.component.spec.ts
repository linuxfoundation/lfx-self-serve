// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { CdpProjectAffiliation, EnrichedIdentity, ProjectGroup } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectService } from '../../../shared/services/project.service';
import { UserService } from '../../../shared/services/user.service';
import { ProfileAffiliationsComponent } from './profile-affiliations.component';

/** Minimal CDP affiliation fixture — only the fields transformToProjectGroups reads. */
function makeCdpAffiliation(slug: string): CdpProjectAffiliation {
  return {
    id: slug,
    projectSlug: slug,
    projectLogo: '',
    projectName: `Project ${slug}`,
    contributionCount: 1,
    roles: [{ id: 'r1', role: 'Contributor', startDate: '', endDate: '', repoUrl: '', repoFileUrl: '' }],
    affiliations: [],
  };
}

type TransformFn = (affiliations: CdpProjectAffiliation[], lfxSlugs: Set<string> | null) => ProjectGroup[];

/**
 * Guards the null-slug (filter-skip) and empty-set (filter-all) branches of
 * transformToProjectGroups added in #1901. The null-vs-empty distinction is the
 * core behavioral contract: null means "slug fetch unavailable, skip LFX filter";
 * an empty Set means "fetch succeeded, no LFX projects, filter all out."
 */
describe('ProfileAffiliationsComponent — transformToProjectGroups', () => {
  let fixture: ComponentFixture<ProfileAffiliationsComponent>;
  let comp: ProfileAffiliationsComponent;

  beforeEach(async () => {
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [ProfileAffiliationsComponent],
      providers: [
        {
          provide: UserService,
          useValue: {
            user: signal(null),
            impersonating: signal(false),
            getCdpProjectAffiliations: () => of([]),
            getWorkExperiences: () => of([]),
            getIdentities: () => of([]),
          },
        },
        {
          provide: ProjectService,
          useValue: { getProjectSlugs: () => of(null) },
        },
        { provide: MessageService, useValue: { add: () => {} } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: DialogService, useValue: { open: () => ({ onClose: of(null) }) } },
      ],
    });
    // Empty template: exercise class logic without rendering PrimeNG children.
    // Clear component-level providers so the module-level stubs above are used.
    TestBed.overrideComponent(ProfileAffiliationsComponent, { set: { template: '', imports: [], providers: [] } });

    fixture = TestBed.createComponent(ProfileAffiliationsComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function transform(affiliations: CdpProjectAffiliation[], lfxSlugs: Set<string> | null): ProjectGroup[] {
    return (comp as unknown as { transformToProjectGroups: TransformFn }).transformToProjectGroups(affiliations, lfxSlugs);
  }

  it('passes all affiliations through when lfxSlugs is null (slug fetch unavailable)', () => {
    const affiliations = [makeCdpAffiliation('slug-a'), makeCdpAffiliation('slug-b'), makeCdpAffiliation('slug-c')];

    const result = transform(affiliations, null);

    expect(result.map((g) => g.id)).toEqual(['slug-a', 'slug-b', 'slug-c']);
  });

  it('filters to only matching slugs when lfxSlugs is a non-empty Set', () => {
    const affiliations = [makeCdpAffiliation('slug-a'), makeCdpAffiliation('slug-b'), makeCdpAffiliation('slug-c')];

    const result = transform(affiliations, new Set(['slug-a', 'slug-c']));

    expect(result.map((g) => g.id)).toEqual(['slug-a', 'slug-c']);
  });

  it('filters all affiliations out when lfxSlugs is an empty Set (fetch succeeded, no LFX projects)', () => {
    const affiliations = [makeCdpAffiliation('slug-a'), makeCdpAffiliation('slug-b')];

    const result = transform(affiliations, new Set());

    expect(result).toHaveLength(0);
  });
});

describe('ProfileAffiliationsComponent — primary email does not count as a connected identity (#4123)', () => {
  function makeIdentity(overrides: Partial<EnrichedIdentity> & Pick<EnrichedIdentity, 'id' | 'value'>): EnrichedIdentity {
    return {
      platform: 'email',
      type: 'email',
      verified: true,
      source: 'cdp',
      icon: 'fa-light fa-envelope',
      createdAt: '',
      updatedAt: '',
      displayState: 'verified',
      inAuth0: false,
      ...overrides,
    };
  }

  async function setup(identities: EnrichedIdentity[]): Promise<ProfileAffiliationsComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProfileAffiliationsComponent],
      providers: [
        {
          provide: UserService,
          useValue: {
            user: signal(null),
            impersonating: signal(false),
            getCdpProjectAffiliations: () => of([]),
            getWorkExperiences: () => of([]),
            getIdentities: () => of(identities),
          },
        },
        { provide: ProjectService, useValue: { getProjectSlugs: () => of(null) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: DialogService, useValue: { open: () => ({ onClose: of(null) }) } },
      ],
    });
    TestBed.overrideComponent(ProfileAffiliationsComponent, { set: { template: '', imports: [], providers: [] } });

    const fixture = TestBed.createComponent(ProfileAffiliationsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  it('keeps the onboarding empty state when the only row is the display-only primary email', async () => {
    const comp = await setup([
      makeIdentity({ id: 'cdp-lfid', platform: 'lfid', type: 'username', value: 'dev-user' }),
      makeIdentity({ id: 'primary-email', value: 'dev@example.com', source: 'auth-service', isPrimary: true }),
    ]);

    expect(comp.hasProfileSetup()).toBe(false);
  });

  it('counts a primary email that is backed by a linked login', async () => {
    const comp = await setup([
      makeIdentity({ id: 'cdp-primary', platform: 'google', value: 'dev@example.com', inAuth0: true, auth0UserId: 'google-oauth2|1', isPrimary: true }),
    ]);

    expect(comp.hasProfileSetup()).toBe(true);
  });

  it('still counts a non-primary connected identity', async () => {
    const comp = await setup([
      makeIdentity({ id: 'primary-email', value: 'dev@example.com', source: 'auth-service', isPrimary: true }),
      makeIdentity({ id: 'cdp-gh', platform: 'github', type: 'username', value: 'dev-gh', icon: 'fa-brands fa-github' }),
    ]);

    expect(comp.hasProfileSetup()).toBe(true);
  });
});
