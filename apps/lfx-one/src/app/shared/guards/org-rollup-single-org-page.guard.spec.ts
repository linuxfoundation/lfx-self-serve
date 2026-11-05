// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, Router, UrlTree } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { AccountContextService } from '../services/account-context.service';
import { orgRollUpSingleOrgPageGuard } from './org-rollup-single-org-page.guard';

/**
 * Cursor on PR #4415. Dropping Organization Profile from the sidebar does not stop the page
 * loading: `navigateToSelectedOrg` canonicalizes a legacy `/org/profile` by inserting the selected
 * segment, so in roll-up mode the app rewrites it to `/org/all/profile` itself, and the page then
 * asks for `/api/orgs/uid/all` and errors.
 */
describe('orgRollUpSingleOrgPageGuard', () => {
  const isRollUp = signal(false);

  beforeEach(() => {
    isRollUp.set(false);
    TestBed.configureTestingModule({
      providers: [{ provide: AccountContextService, useValue: { isRollUp } }],
    });
  });

  const run = (queryParams: Record<string, string> = {}): boolean | UrlTree =>
    TestBed.runInInjectionContext(
      () => orgRollUpSingleOrgPageGuard({ queryParamMap: convertToParamMap(queryParams) } as never, {} as never) as boolean | UrlTree
    );

  it('redirects the roll-up to its own overview', () => {
    isRollUp.set(true);

    const result = run();

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/org/all/overview');
  });

  it('lets a concrete organization through', () => {
    expect(run()).toBe(true);
  });

  /**
   * Copilot on PR #4415. The BFF still mints `/org/easycla/{group}?org={A}&signed=1` while
   * `ORG_EASYCLA_RETURN_IN_PATH` is off. `OrgClaReturnService.adopt` access-checks and adopts that
   * organization, but it has not run when this guard fires — so a roll-up cookie (set in another
   * tab mid-signing) would redirect the return away and lose the agreement destination and the
   * signing confirmation.
   */
  it('lets a corporate-signing return through, roll-up cookie or not', () => {
    isRollUp.set(true);

    expect(run({ org: '0014100000AaaAAAAA', signed: '1' })).toBe(true);
  });

  it('still redirects an EasyCLA address that carries no signing return', () => {
    isRollUp.set(true);

    expect(run({ signed: '1' })).toBeInstanceOf(UrlTree);
  });
});
