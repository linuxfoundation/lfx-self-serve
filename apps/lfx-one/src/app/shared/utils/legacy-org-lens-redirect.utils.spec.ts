// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, Routes } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { legacyDocsMatcher, legacyDocsRedirect, legacyOrgLensMatcher, legacyOrgLensRedirect } from './legacy-org-lens-redirect.utils';

@Component({ selector: 'lfx-stub', template: '' })
class StubComponent {}

const routes: Routes = [
  { matcher: legacyOrgLensMatcher, redirectTo: legacyOrgLensRedirect },
  { path: 'company', children: [{ path: '**', component: StubComponent }] },
  {
    path: 'docs',
    children: [
      { matcher: legacyDocsMatcher, redirectTo: legacyDocsRedirect },
      { path: '**', component: StubComponent },
    ],
  },
  { path: 'organization', component: StubComponent },
];

describe('legacy Company Lens redirects', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
    router = TestBed.inject(Router);
  });

  it.each([
    ['/org', '/company'],
    ['/org/not-found', '/company/not-found'],
    ['/org/acme-inc/projects?employees=a', '/company/acme-inc/projects?employees=a'],
    ['/org/0014100000MgaAAAAA/memberships/lf#seats', '/company/0014100000MgaAAAAA/memberships/lf#seats'],
    ['/org/overview#top', '/company/overview#top'],
    ['/org/easycla/g1?org=001A&signed=1', '/company/easycla/g1?company=001A&signed=1'],
    ['/org/acme/easycla/g1?signed=1', '/company/acme/easycla/g1?signed=1'],
  ])('%s lands on %s', async (from, to) => {
    await router.navigateByUrl(from);
    expect(router.url).toBe(to);
  });

  it('does not touch addresses that only start with the letters org', async () => {
    await router.navigateByUrl('/organization');
    expect(router.url).toBe('/organization');
  });
});

describe('legacy docs redirects', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
    router = TestBed.inject(Router);
  });

  it.each([
    ['/docs/organization', '/docs/company'],
    ['/docs/organization/choose-an-organization', '/docs/company/choose-a-company'],
    ['/docs/organization/org-overview', '/docs/company/company-overview'],
    ['/docs/organization/manage-org-lens-access', '/docs/company/manage-company-lens-access'],
    ['/docs/organization/easycla#what-does-auto-acknowledge-do', '/docs/company/easycla#what-does-auto-acknowledge-do'],
    ['/docs/organization/faq', '/docs/company/faq'],
    ['/docs/dashboards/organization-involvement', '/docs/dashboards/company-involvement'],
    ['/docs/organization/projects', '/docs/company/projects'],
    ['/docs/organization/memberships', '/docs/company/memberships'],
  ])('%s lands on %s', async (from, to) => {
    await router.navigateByUrl(from);
    expect(router.url).toBe(to);
  });
});
