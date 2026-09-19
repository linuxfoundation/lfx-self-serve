// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Signal, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Account } from '@lfx-one/shared/interfaces';
import { orgUrlSegment } from '@lfx-one/shared/utils';
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
  /** Derived exactly as `AccountContextService` derives it, so canonical-record outcomes (slug removed, case, shape) are the real ones. */
  let selectedUrlSegment: Signal<string | null>;
  let service: OrgLensNavigationService;
  let router: Router;
  let navigate: MockInstance<Router['navigate']>;
  let currentUrl: string;

  beforeEach(() => {
    selectedAccount = signal<Account>(acme);
    selectedUrlSegment = computed(() => orgUrlSegment(selectedAccount()));
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
      selectedAccount.set(placeholder);
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      expect(navigate).not.toHaveBeenCalled();
    });

    // The write is keyed to the organization for `reconcileAddress`; a selection that has a slug but
    // no uid yet cannot be keyed, so it is not written.
    it('is a no-op while the selection has a segment but no uid', () => {
      selectedAccount.set({ ...acme, uid: undefined });
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('isOnNotFound', () => {
    it.each([
      ['/org/not-found', true],
      ['/org/not-found?from=x', true],
      ['/org/acme-inc/overview', false],
      ['/org/people', false],
      ['/', false],
    ])('%s → %s', (url, expected) => {
      currentUrl = url;
      expect(service.isOnNotFound()).toBe(expected);
    });
  });

  /**
   * The canonical record can carry a different slug than the indexed row the address was written
   * from (index lag, a rename). The address follows — but only the address this service wrote, for
   * the organization it wrote it for, and only once that navigation has settled.
   */
  describe('reconcileAddress', () => {
    const UID_B = '0014100000MgbBBBBB';
    const beta: Account = { accountId: UID_B, accountName: 'Beta', accountSlug: '', membershipTier: '', uid: UID_B, slug: 'beta-llc' };

    it('replaces the segment it wrote when the selection canonicalizes to another one', async () => {
      currentUrl = '/org/other-org/projects/k8s?tab=active#top';
      service.navigateToSelectedOrg();
      currentUrl = '/org/acme-inc/projects/k8s?tab=active#top';
      navigate.mockClear();

      selectedAccount.set({ ...acme, slug: 'acme-incorporated' });
      await service.reconcileAddress();

      expect(navigatedTo()).toBe('/org/acme-incorporated/projects/k8s');
      expect(navigate.mock.calls[0][1]).toEqual(expect.objectContaining({ replaceUrl: true, queryParamsHandling: 'preserve', preserveFragment: true }));
    });

    // The canonical fetch can settle before the navigation it follows has activated (`Router.url`
    // moves only on activation); the address must be read after the write, not before.
    it('waits for the navigation it follows before reading the address', async () => {
      let activate!: (value: boolean) => void;
      navigate.mockReturnValueOnce(new Promise<boolean>((resolve) => (activate = resolve)));
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      navigate.mockClear();
      selectedAccount.set({ ...acme, slug: 'acme-incorporated' });

      const reconciling = service.reconcileAddress();
      // Still pre-switch on the address bar: nothing may be decided yet.
      expect(navigate).not.toHaveBeenCalled();
      currentUrl = '/org/acme-inc/projects';
      activate(true);
      await reconciling;

      expect(navigatedTo()).toBe('/org/acme-incorporated/projects');
    });

    // A second write while the first is still in flight supersedes it: the first write's canonical
    // record must not re-address the page the second one is heading to.
    it('does nothing for a write that a newer write superseded', async () => {
      let activate!: (value: boolean) => void;
      navigate.mockReturnValueOnce(new Promise<boolean>((resolve) => (activate = resolve)));
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      const reconciling = service.reconcileAddress();

      selectedAccount.set(beta);
      service.navigateToSelectedOrg();
      currentUrl = '/org/beta-llc/projects';
      navigate.mockClear();

      selectedAccount.set({ ...beta, slug: 'beta-llc-renamed' });
      activate(true);
      await reconciling;

      expect(navigate).not.toHaveBeenCalled();
    });

    // A guard cancelled the write (resolves `false`) or the router threw (rejects) and the address
    // never moved: nothing to reconcile, and no unhandled rejection either way.
    it.each([
      ['cancelled', (): Promise<boolean> => Promise.resolve(false)],
      ['errored', (): Promise<boolean> => Promise.reject(new Error('navigation failed'))],
    ])('settles cleanly and leaves an address the %s write never reached', async (_label, outcome) => {
      navigate.mockReturnValueOnce(outcome());
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      navigate.mockClear();
      selectedAccount.set({ ...acme, slug: 'acme-incorporated' });

      await expect(service.reconcileAddress()).resolves.toBeUndefined();
      expect(navigate).not.toHaveBeenCalled();
    });

    // A cancelled write is not necessarily a write that left nothing behind: a flag guard can redirect
    // `/org/acme-inc/roi` to `/org/acme-inc/overview` — the original navigation resolves `false`, the
    // organization segment is in the address all the same, and it still wants the canonical slug.
    it('still reconciles when a redirected write left the written segment in the address', async () => {
      navigate.mockReturnValueOnce(Promise.resolve(false));
      currentUrl = '/org/other-org/roi';
      service.navigateToSelectedOrg();
      currentUrl = '/org/acme-inc/overview';
      navigate.mockClear();
      selectedAccount.set({ ...acme, slug: 'acme-incorporated' });

      await service.reconcileAddress();

      expect(navigatedTo()).toBe('/org/acme-incorporated/overview');
    });

    // The reconciling navigation itself is stored for a later reconcile to await — so it must not be
    // able to reject unhandled if a guard throws on the canonical address.
    it('never lets its own navigation reject unhandled', async () => {
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      currentUrl = '/org/acme-inc/projects';
      navigate.mockReturnValueOnce(Promise.reject(new Error('navigation failed')));
      selectedAccount.set({ ...acme, slug: 'acme-incorporated' });

      await service.reconcileAddress();
      await expect(service.reconcileAddress()).resolves.toBeUndefined();
    });

    // A rename can remove the slug outright (`slug: null` is authoritative): the address falls to the
    // SFID form, exactly as `orgUrlSegment` would produce it.
    it('falls back to the SFID when the canonical record carries no slug', async () => {
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      currentUrl = '/org/acme-inc/projects';
      navigate.mockClear();

      selectedAccount.set({ ...acme, slug: null });
      await service.reconcileAddress();

      expect(navigatedTo()).toBe(`/org/${UID_A}/projects`);
    });

    // The canonical slug is normalized the same way the written one was, so a case or whitespace
    // difference is not a change of address.
    it.each(['ACME-Inc', '  acme-inc  '])('is a no-op when the canonical slug %p normalizes to what was written', async (slug) => {
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      currentUrl = '/org/acme-inc/projects';
      navigate.mockClear();

      selectedAccount.set({ ...acme, slug });
      await service.reconcileAddress();

      expect(navigate).not.toHaveBeenCalled();
    });

    it('is a no-op when the canonical segment matches what was written', async () => {
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      currentUrl = '/org/acme-inc/projects';
      navigate.mockClear();

      await service.reconcileAddress();

      expect(navigate).not.toHaveBeenCalled();
    });

    // A switch wrote Beta's address; a later default selected Acme and (correctly) left the addressed
    // page alone. Acme's canonical record must not turn Beta's page into Acme's either.
    it('never re-addresses a page written for another organization', async () => {
      selectedAccount.set(beta);
      currentUrl = '/org/acme-inc/projects';
      service.navigateToSelectedOrg('switch');
      currentUrl = '/org/beta-llc/projects';
      navigate.mockClear();

      selectedAccount.set(acme);
      await service.reconcileAddress();

      expect(navigate).not.toHaveBeenCalled();
    });

    it('leaves an address it did not write alone, even when the segment changed', async () => {
      currentUrl = '/org/other-org/projects';
      service.navigateToSelectedOrg();
      // The viewer has moved on to a page this service did not address.
      currentUrl = '/org/third-org/people';
      navigate.mockClear();

      selectedAccount.set({ ...acme, slug: 'acme-incorporated' });
      await service.reconcileAddress();

      expect(navigate).not.toHaveBeenCalled();
    });

    it('is a no-op before anything was written', async () => {
      currentUrl = '/org/acme-inc/projects';
      selectedAccount.set({ ...acme, slug: 'acme-incorporated' });
      await service.reconcileAddress();
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
