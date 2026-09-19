// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Account } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgLensNavigationService } from './org-lens-navigation.service';

// Spec 050 US2: the address names the organization on screen. These cases pin what a switch does
// to the address on each kind of page, and what links are built while a selection exists or not.
describe('OrgLensNavigationService', () => {
  const UID_A = '0014100000MgaAAAAA';
  const acme: Account = { accountId: UID_A, accountName: 'Acme', accountSlug: '', membershipTier: '', uid: UID_A, slug: 'acme-inc' };
  const placeholder: Account = { accountId: '', accountName: '', accountSlug: '', membershipTier: '' };

  let selectedAccount: WritableSignal<Account>;
  let selectedUrlSegment: WritableSignal<string | null>;
  let service: OrgLensNavigationService;
  let router: Router;
  let navigate: MockInstance<Router['navigate']>;
  let currentUrl: string;

  beforeEach(() => {
    selectedAccount = signal<Account>(acme);
    selectedUrlSegment = signal<string | null>('acme-inc');
    currentUrl = '/';
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AccountContextService, useValue: { selectedAccount, selectedUrlSegment } }],
    });
    router = TestBed.inject(Router);
    Object.defineProperty(router, 'url', { get: () => currentUrl });
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    service = TestBed.inject(OrgLensNavigationService);
  });

  const navigatedTo = (): string | null =>
    navigate.mock.calls.length ? router.serializeUrl(router.createUrlTree(navigate.mock.calls[0][0] as string[])) : null;

  describe('orgLensLink', () => {
    it('addresses the selected organization', () => {
      expect(service.orgLensLink('projects')).toEqual(['/org', 'acme-inc', 'projects']);
      expect(service.orgLensLink('projects', 'k8s')).toEqual(['/org', 'acme-inc', 'projects', 'k8s']);
      expect(service.orgLensPath('roi')).toBe('/org/acme-inc/roi');
    });

    it('falls back to the legacy page address while nothing is selected', () => {
      selectedUrlSegment.set(null);
      selectedAccount.set(placeholder);
      expect(service.orgLensLink('memberships', 'cncf')).toEqual(['/org', 'memberships', 'cncf']);
    });
  });

  describe('navigateToSelectedOrg', () => {
    it('swaps the organization and keeps the page, query and fragment on an addressed page', () => {
      currentUrl = '/org/other-org/projects/k8s?card=contributors#top';
      service.navigateToSelectedOrg();
      expect(navigatedTo()).toBe('/org/acme-inc/projects/k8s');
      // Pushed, not replaced: a switch is a user intent, and Back must return to the pre-switch
      // organization and page (US2 scenario 3).
      expect(navigate.mock.calls[0][1]).toEqual(expect.objectContaining({ replaceUrl: false, queryParamsHandling: 'preserve', preserveFragment: true }));
    });

    it('inserts the organization on a legacy page address', () => {
      currentUrl = '/org/people';
      service.navigateToSelectedOrg();
      expect(navigatedTo()).toBe('/org/acme-inc/people');
    });

    it.each(['/org/not-found', '/org'])('lands on the overview from %s', (url) => {
      currentUrl = url;
      service.navigateToSelectedOrg();
      expect(navigatedTo()).toBe('/org/acme-inc/overview');
    });

    it.each(['/org/acme-inc/projects', `/org/${UID_A}/projects`])('is a no-op when the address already names the selection (%s)', (url) => {
      currentUrl = url;
      service.navigateToSelectedOrg();
      expect(navigate).not.toHaveBeenCalled();
    });

    it.each(['/org/easycla', '/org/easycla/abc-123', '/project/cncf/overview', '/'])('is a no-op on %s', (url) => {
      currentUrl = url;
      service.navigateToSelectedOrg();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('is a no-op while no segment is known', () => {
      selectedUrlSegment.set(null);
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  /**
   * An automatic default is not a switch: it only fills an organization into an address that names
   * none, and it replaces the entry (FR-011) so Back cannot land on the bare, uncopyable form.
   */
  describe("navigateToSelectedOrg('default')", () => {
    it('inserts the organization on a legacy page address and replaces the history entry', () => {
      currentUrl = '/org/people?tab=admins#top';
      service.navigateToSelectedOrg('default');
      expect(navigatedTo()).toBe('/org/acme-inc/people');
      expect(navigate.mock.calls[0][1]).toEqual(expect.objectContaining({ replaceUrl: true, queryParamsHandling: 'preserve', preserveFragment: true }));
    });

    it('lands on the overview from the bare /org', () => {
      currentUrl = '/org';
      service.navigateToSelectedOrg('default');
      expect(navigatedTo()).toBe('/org/acme-inc/overview');
    });

    // FR-022–FR-024 / SC-004: the dead end stays a dead end. Only the viewer's own pick leaves it;
    // a default picked from the org list would silently substitute another organization for the
    // one the link named.
    it('never leaves the not-found page', () => {
      currentUrl = '/org/not-found';
      service.navigateToSelectedOrg('default');
      expect(navigate).not.toHaveBeenCalled();
    });

    // The org list can answer before the path guard has adopted the addressed organization; the
    // address is the authority then, not the default.
    it('never overrides an address that already names an organization', () => {
      currentUrl = '/org/other-org/projects/k8s';
      service.navigateToSelectedOrg('default');
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
