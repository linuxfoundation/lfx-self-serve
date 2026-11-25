// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { ORG_CLA_ONLY_GRANTS_WAIT_MS } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgLensViewModeService } from '../services/org-lens-view-mode.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { orgLensFullViewOnlyGuard } from './org-lens-full-view-only.guard';

describe('orgLensFullViewOnlyGuard', () => {
  let isEmployeeView: WritableSignal<boolean>;
  let loaded: WritableSignal<boolean>;
  let managesClas: WritableSignal<boolean>;
  let router: Router;

  /** A route snapshot with these query params, mounted at the legacy `/org/easycla/...` address when `legacyEasycla` is set. */
  const routeFor = (query: Record<string, string>, legacyEasycla = false): ActivatedRouteSnapshot =>
    ({
      queryParamMap: { get: (name: string) => query[name] ?? null },
      pathFromRoot: legacyEasycla ? [{ routeConfig: { path: 'easycla' } }] : [],
    }) as unknown as ActivatedRouteSnapshot;

  const verdictFor = async (url: string, page?: string): Promise<string | true> => {
    const result = await TestBed.runInInjectionContext(() => orgLensFullViewOnlyGuard(page)({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
    return result === true ? true : router.serializeUrl(result as UrlTree);
  };

  // The EasyCLA route: CLA Managers of the company keep the page in the employee view.
  const easyClaVerdictFor = async (url: string, route: ActivatedRouteSnapshot = routeFor({})): Promise<string | true> => {
    const result = await TestBed.runInInjectionContext(() =>
      orgLensFullViewOnlyGuard(undefined, { keepForClaManager: true })(route, { url } as RouterStateSnapshot)
    );
    return result === true ? true : router.serializeUrl(result as UrlTree);
  };

  beforeEach(() => {
    isEmployeeView = signal(false);
    loaded = signal(true);
    managesClas = signal(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: OrgLensViewModeService, useValue: { isEmployeeView, managesSelectedCompanyClas: managesClas } },
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

  it('waits for the role grants before deciding, then redirects once the employee view is known', async () => {
    // Neither signal is set when the guard starts, so it cannot return at the recorded-mode check and must wait.
    loaded.set(false);
    isEmployeeView.set(false);
    const pending = verdictFor('/company/acme-inc/people');
    let settled = false;
    void pending.then(() => (settled = true));

    await Promise.resolve();
    expect(settled).toBe(false);

    isEmployeeView.set(true);
    loaded.set(true);

    expect(await pending).toBe('/company/acme-inc/overview');
  });

  it('waits for the role grants and admits the page when the full view is confirmed', async () => {
    loaded.set(false);
    const pending = verdictFor('/company/acme-inc/people');

    loaded.set(true);

    expect(await pending).toBe(true);
  });

  it('redirects a recorded employee view without waiting for the role grants', async () => {
    loaded.set(false);
    isEmployeeView.set(true);

    expect(await verdictFor('/company/acme-inc/people')).toBe('/company/acme-inc/overview');
  });

  it('redirects when the mode is recorded while the role-grants wait runs out', async () => {
    vi.useFakeTimers();
    try {
      loaded.set(false);
      const pending = verdictFor('/company/acme-inc/people');
      isEmployeeView.set(true);
      await vi.advanceTimersByTimeAsync(ORG_CLA_ONLY_GRANTS_WAIT_MS + 1);

      expect(await pending).toBe('/company/acme-inc/overview');
    } finally {
      vi.useRealTimers();
    }
  });

  it('admits the page when the wait runs out with no employee view recorded', async () => {
    vi.useFakeTimers();
    try {
      loaded.set(false);
      const pending = verdictFor('/company/acme-inc/people');
      await vi.advanceTimersByTimeAsync(ORG_CLA_ONLY_GRANTS_WAIT_MS + 1);

      expect(await pending).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('redirects to the page it is given', async () => {
    isEmployeeView.set(true);

    expect(await verdictFor('/company/acme-inc/groups', 'projects')).toBe('/company/acme-inc/projects');
  });

  it('redirects every EasyCLA address (page, CLA group detail, signing return, legacy mount) to Overview in the employee view', async () => {
    isEmployeeView.set(true);

    expect(await verdictFor('/company/acme-inc/easycla')).toBe('/company/acme-inc/overview');
    expect(await verdictFor('/company/acme-inc/easycla/7c1a9000-0000-4000-8000-000000000001?sig=abc&signed=1')).toBe('/company/acme-inc/overview');
    expect(await verdictFor('/company/easycla/7c1a9000-0000-4000-8000-000000000001?company=acme-inc&signed=1')).toBe('/company/overview');
  });

  it('redirects the Groups page to the Overview in the employee view, and opens it in the full view (#5859)', async () => {
    expect(await verdictFor('/company/acme-inc/groups')).toBe(true);

    isEmployeeView.set(true);

    expect(await verdictFor('/company/acme-inc/groups')).toBe('/company/acme-inc/overview');
  });

  describe('EasyCLA for a CLA Manager (keepForClaManager)', () => {
    it('lets a corporate-signing return on the legacy mount through, so the page can adopt the company it names', async () => {
      isEmployeeView.set(true);
      managesClas.set(false);

      expect(
        await easyClaVerdictFor('/company/easycla/g1?company=0014100000OtherAAAA&signed=1', routeFor({ company: '0014100000OtherAAAA', signed: '1' }, true))
      ).toBe(true);
    });

    it('still redirects an employee-view caller from the same query on an address that is not the legacy mount', async () => {
      isEmployeeView.set(true);
      managesClas.set(false);

      expect(await easyClaVerdictFor('/company/easycla/g1?company=0014100000OtherAAAA', routeFor({ company: '0014100000OtherAAAA' }, false))).not.toBe(true);
    });

    it('still redirects an employee who does not manage the company CLAs', async () => {
      isEmployeeView.set(true);

      expect(await easyClaVerdictFor('/company/acme-inc/easycla')).toBe('/company/acme-inc/overview');
    });

    it('keeps the page open for an employee who is also the company CLA Manager, signing return included', async () => {
      isEmployeeView.set(true);
      managesClas.set(true);

      expect(await easyClaVerdictFor('/company/acme-inc/easycla')).toBe(true);
      expect(await easyClaVerdictFor('/company/acme-inc/easycla/7c1a9000-0000-4000-8000-000000000001?signed=1')).toBe(true);
    });

    it('waits for the role grants before deciding, because the CLA scopes arrive with them', async () => {
      loaded.set(false);
      isEmployeeView.set(true);
      const pending = easyClaVerdictFor('/company/acme-inc/easycla');

      managesClas.set(true);
      loaded.set(true);

      expect(await pending).toBe(true);
    });

    it('admits when the wait runs out, leaving the decision to the server', async () => {
      vi.useFakeTimers();
      try {
        loaded.set(false);
        isEmployeeView.set(true);
        const pending = easyClaVerdictFor('/company/acme-inc/easycla');
        await vi.advanceTimersByTimeAsync(ORG_CLA_ONLY_GRANTS_WAIT_MS + 1);

        expect(await pending).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('opens the page in the full view', async () => {
      expect(await easyClaVerdictFor('/company/acme-inc/easycla')).toBe(true);
    });
  });
});
