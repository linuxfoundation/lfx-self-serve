// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgLensViewModeService } from '../services/org-lens-view-mode.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { orgLensFullViewOnlyGuard } from './org-lens-full-view-only.guard';

describe('orgLensFullViewOnlyGuard', () => {
  let isEmployeeView: WritableSignal<boolean>;
  let loaded: WritableSignal<boolean>;
  let router: Router;

  const verdictFor = async (url: string, page?: string): Promise<string | true> => {
    const result = await TestBed.runInInjectionContext(() => orgLensFullViewOnlyGuard(page)({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
    return result === true ? true : router.serializeUrl(result as UrlTree);
  };

  beforeEach(() => {
    isEmployeeView = signal(false);
    loaded = signal(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: OrgLensViewModeService, useValue: { isEmployeeView } },
        { provide: OrgRoleGrantsService, useValue: { loaded } },
      ],
    });
    router = TestBed.inject(Router);
  });

  it('opens the page in the full view', async () => {
    expect(await verdictFor('/company/acme-inc/people')).toBe(true);
  });

  it('redirects to the Overview of the company the address names in the employee view', async () => {
    isEmployeeView.set(true);

    expect(await verdictFor('/company/acme-inc/people')).toBe('/company/acme-inc/overview');
    expect(await verdictFor('/company/people')).toBe('/company/overview');
  });

  it('waits for the role grants before deciding', async () => {
    loaded.set(false);
    isEmployeeView.set(true);
    const pending = verdictFor('/company/acme-inc/people');

    loaded.set(true);

    expect(await pending).toBe('/company/acme-inc/overview');
  });

  it('redirects to the page it is given', async () => {
    isEmployeeView.set(true);

    expect(await verdictFor('/company/acme-inc/groups', 'projects')).toBe('/company/acme-inc/projects');
  });
});
