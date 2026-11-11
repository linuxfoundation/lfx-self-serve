// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, Router, UrlTree } from '@angular/router';
import { ORG_SEGMENT_PARAM } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { AccountContextService } from '../services/account-context.service';
import { orgRollUpSingleOrgPageGuard } from './org-rollup-single-org-page.guard';

/**
 * Cursor on PR #4415. Dropping Organization Profile from the sidebar does not stop the page
 * loading: `navigateToSelectedOrg` canonicalizes a legacy `/company/profile` by inserting the selected
 * segment, so in roll-up mode the app rewrites it to `/company/family-{id}/profile` itself, and the
 * page then asks for `/api/orgs/uid/family-{id}` and errors.
 */
describe('orgRollUpSingleOrgPageGuard', () => {
  const FAMILY_SEGMENT = 'family-0014100000RootAAAA';
  const isRollUp = signal(false);
  const selectedAccount = signal({ uid: FAMILY_SEGMENT });

  beforeEach(() => {
    isRollUp.set(false);
    TestBed.configureTestingModule({
      providers: [{ provide: AccountContextService, useValue: { isRollUp, selectedAccount } }],
    });
  });

  /**
   * A route snapshot shaped like the real tree: the page node, and above it the `:orgSegment`
   * parent on the addressed mount only. `pathFromRoot` is what the guard walks to tell the two
   * mounts apart, so the fixture has to carry it.
   */
  const snapshot = (opts: { page: 'profile' | 'easycla' | 'donations'; addressed?: boolean; queryParams?: Record<string, string> }) => {
    const page = { routeConfig: { path: opts.page }, queryParamMap: convertToParamMap(opts.queryParams ?? {}) };
    const pathFromRoot = opts.addressed ? [{ routeConfig: { path: `:${ORG_SEGMENT_PARAM}` } }, page] : [page];
    return { ...page, pathFromRoot } as never;
  };

  const run = (opts: Parameters<typeof snapshot>[0]): boolean | UrlTree =>
    TestBed.runInInjectionContext(() => orgRollUpSingleOrgPageGuard(snapshot(opts), {} as never) as boolean | UrlTree);

  const redirectsToRollUpOverview = (result: boolean | UrlTree): void => {
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(`/company/${FAMILY_SEGMENT}/overview`);
  };

  it('lets a concrete organization through', () => {
    expect(run({ page: 'profile' })).toBe(true);
    expect(run({ page: 'easycla', addressed: true })).toBe(true);
  });

  it.each([
    ['addressed Profile', { page: 'profile' as const, addressed: true }],
    ['legacy Profile', { page: 'profile' as const }],
    ['addressed EasyCLA', { page: 'easycla' as const, addressed: true }],
    ['legacy EasyCLA with no return', { page: 'easycla' as const }],
    ['addressed Donations', { page: 'donations' as const, addressed: true }],
    ['legacy Donations, parameter or not', { page: 'donations' as const, queryParams: { company: '0014100000AaaAAAAA' } }],
  ])('redirects %s to the roll-up overview', (_label, opts) => {
    isRollUp.set(true);
    redirectsToRollUpOverview(run(opts));
  });

  /**
   * Copilot on PR #4415. The BFF still mints `/company/easycla/{group}?company={A}&signed=1` while
   * `ORG_EASYCLA_RETURN_IN_PATH` is off. `OrgClaReturnService.adopt` access-checks and adopts that
   * organization, but it has not run when this guard fires — so a roll-up cookie (set in another
   * tab mid-signing) would redirect the return away and lose the agreement destination and the
   * signing confirmation.
   */
  it('lets a legacy corporate-signing return through, roll-up cookie or not', () => {
    isRollUp.set(true);

    expect(run({ page: 'easycla', queryParams: { company: '0014100000AaaAAAAA', signed: '1' } })).toBe(true);
  });

  /**
   * Copilot again, on the first fix: keying on `?company=` alone was too wide. Only EasyCLA adopts the
   * parameter, only the legacy mount can carry such a return, and an empty value adopts nothing —
   * so each of these is a hand-made address aimed at a roll-up, not a signing return.
   */
  it.each([
    ['Profile, which never adopts the parameter', { page: 'profile' as const, queryParams: { company: '0014100000AaaAAAAA' } }],
    [
      'an addressed EasyCLA, which already names its organization',
      { page: 'easycla' as const, addressed: true, queryParams: { company: '0014100000AaaAAAAA' } },
    ],
    ['a return whose organization is empty', { page: 'easycla' as const, queryParams: { company: '   ', signed: '1' } }],
  ])('still redirects %s', (_label, opts) => {
    isRollUp.set(true);
    redirectsToRollUpOverview(run(opts));
  });
});
