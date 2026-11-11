// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, Signal, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router } from '@angular/router';
import { ORG_SEGMENT_PARAM } from '@lfx-one/shared/constants';
import { Account } from '@lfx-one/shared/interfaces';
import { orgUrlSegment } from '@lfx-one/shared/utils';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgLensNavigationService } from './org-lens-navigation.service';

// Spec 050 US2: the address names the organization on screen. These cases pin what a switch does
// to the address on each kind of page, and what links are built while a selection exists or not.
describe('OrgLensNavigationService', () => {
  const UID_A = '0014100000MgaAAAAA';
  const acme: Account = { accountId: UID_A, accountName: 'Acme', membershipTier: '', uid: UID_A, slug: 'acme-inc' };
  const placeholder: Account = { accountId: '', accountName: '', membershipTier: '' };

  let selectedAccount: WritableSignal<Account>;
  /** Derived exactly as `AccountContextService` derives it (slug, else SFID; reserved names fall back). */
  let selectedUrlSegment: Signal<string | null>;
  let isAddressedSelection: WritableSignal<boolean>;
  let service: OrgLensNavigationService;
  let router: Router;
  let navigate: MockInstance<Router['navigate']>;
  let currentUrl: string;

  beforeEach(() => {
    selectedAccount = signal<Account>(acme);
    selectedUrlSegment = computed(() => orgUrlSegment(selectedAccount()));
    isAddressedSelection = signal(false);
    currentUrl = '/';
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AccountContextService, useValue: { selectedAccount, selectedUrlSegment, isAddressedSelection } }],
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
      expect(service.orgLensLink('projects')).toEqual(['/company', 'acme-inc', 'projects']);
      expect(service.orgLensLink('projects', 'k8s')).toEqual(['/company', 'acme-inc', 'projects', 'k8s']);
      expect(service.orgLensPath('roi')).toBe('/company/acme-inc/roi');
    });

    it('falls back to the legacy page address while nothing is selected', () => {
      selectedAccount.set(placeholder);
      expect(service.orgLensLink('memberships', 'cncf')).toEqual(['/company', 'memberships', 'cncf']);
    });
  });

  describe('orgLensLandingLink', () => {
    it("addresses the overview of a selection carrying the index slug, the menu's Dashboard link", () => {
      expect(service.orgLensLandingLink()).toEqual(['/company', 'acme-inc', 'overview']);
    });

    it('addresses a uid-only selection once it is pinned, by an address or by the org list', () => {
      selectedAccount.set({ ...placeholder, uid: UID_A });
      isAddressedSelection.set(true);
      expect(service.orgLensLandingLink()).toEqual(['/company', UID_A, 'overview']);
    });

    it('lands an unconfirmed uid-only stub restored from the cookie on the legacy overview, for the org list to re-address', () => {
      selectedAccount.set({ ...placeholder, uid: UID_A });
      expect(service.orgLensLandingLink()).toEqual(['/company', 'overview']);
    });

    it('lands on the legacy overview while nothing is selected', () => {
      selectedAccount.set(placeholder);
      expect(service.orgLensLandingLink()).toEqual(['/company', 'overview']);
    });
  });

  describe('isOnAddressedPage', () => {
    it.each([
      ['/company/acme-inc/overview', true],
      [`/company/${UID_A}/projects/k8s`, true],
      ['/company/overview', false],
      ['/company/easycla/abc-123', false],
      ['/company', false],
      ['/company/not-found', false],
      ['/project/cncf/overview', false],
    ])('%s → %s', (url, expected) => {
      currentUrl = url;
      expect(service.isOnAddressedPage()).toBe(expected);
    });
  });

  describe('navigateToSelectedOrg', () => {
    it('swaps the organization and keeps the page, query and fragment on an addressed page, dropping only ?employees=', () => {
      currentUrl = '/company/other-org/projects/k8s?card=contributors&employees=p-1#top';
      service.navigateToSelectedOrg();
      expect(navigatedTo()).toBe('/company/acme-inc/projects/k8s');
      // Pushed, not replaced: a switch is a user intent, and Back must return to the pre-switch
      // organization and page (US2 scenario 3).
      expect(navigate.mock.calls[0][1]).toEqual(
        expect.objectContaining({ replaceUrl: false, queryParamsHandling: 'merge', queryParams: { employees: null }, preserveFragment: true })
      );
    });

    // DR-004 exemption ended (lfx-self-serve#2743): EasyCLA pages re-address like every other page.
    it.each([
      ['/company/easycla', '/company/acme-inc/easycla'],
      ['/company/easycla/abc-123', '/company/acme-inc/easycla/abc-123'],
      ['/company/other-org/easycla/abc-123', '/company/acme-inc/easycla/abc-123'],
    ])('re-addresses EasyCLA pages too (%s)', (url, expected) => {
      currentUrl = url;
      service.navigateToSelectedOrg();
      expect(navigatedTo()).toBe(expected);
    });

    // A switch off a pre-deploy return (`/company/easycla/{g}?org={A}&signed=1`) must not carry the
    // return state onto the organization-addressed page: preserved, `?org=` would be re-adopted
    // under B's address (undoing the switch) and `?signed=1` would resume A's wait under B. The
    // rest of the query (`?sig=`) still describes the page and rides along.
    it('drops the return parameters, and only those, when a switch leaves a legacy EasyCLA address', () => {
      currentUrl = '/company/easycla/abc-123?org=0014100000MgbBBBBB&signed=1&sig=s1';
      service.navigateToSelectedOrg('switch');
      expect(navigatedTo()).toBe('/company/acme-inc/easycla/abc-123');
      expect(navigate.mock.calls[0][1]).toEqual(
        expect.objectContaining({ queryParamsHandling: 'merge', queryParams: { employees: null, company: null, org: null, signed: null } })
      );
    });

    // A gated return (`/company/{A}/easycla/{g}?signed=1`) is the same trip on the other mount: the
    // page is reused across the switch, so a preserved `?signed=1` would resume A's wait under B.
    // Return state never belongs to another organization, whichever mount it started on.
    it('drops the return parameters when a switch leaves an organization-addressed EasyCLA page', () => {
      currentUrl = '/company/other-org/easycla/abc-123?signed=1&org=0014100000MgbBBBBB&sig=s1';
      service.navigateToSelectedOrg('switch');
      expect(navigatedTo()).toBe('/company/acme-inc/easycla/abc-123');
      expect(navigate.mock.calls[0][1]).toEqual(
        expect.objectContaining({ queryParamsHandling: 'merge', queryParams: { employees: null, company: null, org: null, signed: null } })
      );
    });

    // An Employees selection came from the previous organization's roster, so a switch drops it on
    // every Org Lens page; the rest of the query still describes the page and is merged through.
    it('drops ?employees=, and only that, on a switch between organization-addressed non-EasyCLA pages', () => {
      currentUrl = '/company/other-org/contributions?range=90d&employees=p-1';
      service.navigateToSelectedOrg('switch');
      expect(navigatedTo()).toBe('/company/acme-inc/contributions');
      expect(navigate.mock.calls[0][1]).toEqual(expect.objectContaining({ queryParamsHandling: 'merge', queryParams: { employees: null } }));
    });

    // Why the selector's same-org early return is load-bearing: on a legacy address a switch does
    // not know the selection is unchanged (there is no segment to compare) and inserts regardless.
    it('inserts the organization on a legacy page address even when the selection did not change', () => {
      currentUrl = '/company/people';
      service.navigateToSelectedOrg('switch');
      expect(navigatedTo()).toBe('/company/acme-inc/people');
    });

    // A legacy address names no organization to go back to — Back would re-render it under the new
    // selection — so the insert replaces the entry even for a switch.
    it('inserts the organization on a legacy page address, replacing the entry', () => {
      currentUrl = '/company/people';
      service.navigateToSelectedOrg();
      expect(navigatedTo()).toBe('/company/acme-inc/people');
      expect(navigate.mock.calls[0][1]).toEqual(expect.objectContaining({ replaceUrl: true }));
    });

    it('lands on the overview from the bare /company, replacing the entry', () => {
      currentUrl = '/company';
      service.navigateToSelectedOrg();
      expect(navigatedTo()).toBe('/company/acme-inc/overview');
      expect(navigate.mock.calls[0][1]).toEqual(expect.objectContaining({ replaceUrl: true }));
    });

    // The dead end is a page the viewer came from and can meaningfully return to, so the pick pushes.
    // Anything beneath it is still the dead end ('not-found' is also a page-segment key, so the
    // subtree check must win over the legacy-insert branch), and lands on the overview too.
    it.each(['/company/not-found', '/company/not-found/anything'])('lands on the overview from %s, pushing the entry', (url) => {
      currentUrl = url;
      service.navigateToSelectedOrg();
      expect(navigatedTo()).toBe('/company/acme-inc/overview');
      expect(navigate.mock.calls[0][1]).toEqual(expect.objectContaining({ replaceUrl: false }));
    });

    it.each(['/company/acme-inc/projects', `/company/${UID_A}/projects`])('is a no-op when the address already names the selection (%s)', (url) => {
      currentUrl = url;
      service.navigateToSelectedOrg();
      expect(navigate).not.toHaveBeenCalled();
    });

    it.each(['/project/cncf/overview', '/'])('is a no-op outside Org Lens (%s)', (url) => {
      currentUrl = url;
      service.navigateToSelectedOrg();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('is a no-op while no segment is known', () => {
      selectedAccount.set(placeholder);
      currentUrl = '/company/other-org/projects';
      service.navigateToSelectedOrg();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  /**
   * Copilot on PR #4415. The roll-up pick always pushed, so an address naming no organization — a
   * bare `/org` or a legacy `/org/{page}` the org list had not canonicalized yet — stayed in
   * history. Back then re-rendered that same screen under the *new* roll-up selection instead of
   * returning to the organization the pick was made from.
   */
  describe('navigateToRollUpHome', () => {
    it.each([['/org'], ['/org/people'], ['/org/easycla/abc-123']])('replaces an address that names no organization (%s)', (url) => {
      currentUrl = url;
      service.navigateToRollUpHome('0014100000RootAAAA');
      expect(navigatedTo()).toBe('/org/family-0014100000RootAAAA/overview');
      expect(navigate.mock.calls[0][1]).toEqual(expect.objectContaining({ replaceUrl: true }));
    });

    it.each([['/org/acme-inc/projects'], ['/org/not-found']])('pushes from an address Back should return to (%s)', (url) => {
      currentUrl = url;
      service.navigateToRollUpHome('0014100000RootAAAA');
      expect(navigatedTo()).toBe('/org/family-0014100000RootAAAA/overview');
      expect(navigate.mock.calls[0][1]?.replaceUrl).toBeFalsy();
    });

    // Picked from another lens: there is no Org Lens address to canonicalize, so Back returns there.
    it('pushes from outside Org Lens', () => {
      currentUrl = '/meetings';
      service.navigateToRollUpHome('0014100000RootAAAA');
      expect(navigate.mock.calls[0][1]?.replaceUrl).toBeFalsy();
    });
  });

  describe('isOnNotFound', () => {
    it.each([
      ['/company/not-found', true],
      ['/company/not-found?from=x', true],
      // Beneath the dead end is still the dead end — never the legacy `not-found` page segment.
      ['/company/not-found/anything', true],
      ['/company/acme-inc/overview', false],
      ['/company/people', false],
      ['/', false],
    ])('%s → %s', (url, expected) => {
      currentUrl = url;
      expect(service.isOnNotFound()).toBe(expected);
    });
  });

  /**
   * An automatic default is not a switch: it only fills an organization into an address that names
   * none, and it replaces the entry (FR-011) so Back cannot land on the bare, uncopyable form.
   */
  describe("navigateToSelectedOrg('default')", () => {
    it('inserts the organization on a legacy page address and replaces the history entry', () => {
      currentUrl = '/company/people?tab=admins#top';
      service.navigateToSelectedOrg('default');
      expect(navigatedTo()).toBe('/company/acme-inc/people');
      expect(navigate.mock.calls[0][1]).toEqual(expect.objectContaining({ replaceUrl: true, queryParamsHandling: 'preserve', preserveFragment: true }));
      expect(navigate.mock.calls[0][1]).not.toHaveProperty('queryParams');
    });

    it('lands on the overview from the bare /company', () => {
      currentUrl = '/company';
      service.navigateToSelectedOrg('default');
      expect(navigatedTo()).toBe('/company/acme-inc/overview');
    });

    // DR-004 Option-B trace: a pre-deploy corporate-signing return on the legacy EasyCLA address
    // names its organization in `?org=`, which the page adopts after the org list has answered — a
    // default insert in between would address the default organization instead.
    it('leaves a legacy EasyCLA return address alone', () => {
      currentUrl = '/company/easycla/abc-123?org=0014100000MgbBBBBB&signed=1';
      service.navigateToSelectedOrg('default');
      expect(navigate).not.toHaveBeenCalled();
    });

    // Without the return parameter there is nothing to adopt later; a plain leftover visit is a
    // legacy page like any other and gets its organization inserted.
    it.each(['/company/easycla', '/company/easycla/abc-123?sig=s1'])('inserts the organization on a plain legacy EasyCLA address (%s)', (url) => {
      currentUrl = url;
      service.navigateToSelectedOrg('default');
      expect(navigatedTo()).toMatch(/^\/company\/acme-inc\/easycla/);
    });

    // FR-022–FR-024 / SC-004: the dead end stays a dead end. Only the viewer's own pick leaves it;
    // a default picked from the org list would silently substitute another organization for the
    // one the link named.
    it.each(['/company/not-found', '/company/not-found/anything'])('never leaves the not-found page (%s)', (url) => {
      currentUrl = url;
      service.navigateToSelectedOrg('default');
      expect(navigate).not.toHaveBeenCalled();
    });

    // The org list can answer before the path guard has adopted the addressed organization; the
    // address is the authority then, not the default.
    it('never overrides an address that already names an organization', () => {
      currentUrl = '/company/other-org/projects/k8s';
      service.navigateToSelectedOrg('default');
      expect(navigate).not.toHaveBeenCalled();
    });

    // A gated corporate-signing return (`/company/{A}/easycla/{g}?signed=1`) is an addressed page
    // with a wait in flight. The default must leave it — and its `?signed=` — exactly as it is:
    // the strip belongs to the viewer's own switch off the page, never to the automatic default.
    it('never touches an organization-addressed EasyCLA return, wait state included', () => {
      currentUrl = '/company/other-org/easycla/abc-123?signed=1';
      service.navigateToSelectedOrg('default');
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  // The one predicate both EasyCLA pages use to decide whether a client-supplied `?org=` may
  // name the organization. Driven through the real router over the real route shape (the
  // `:orgSegment` parameter lives on an ancestor of the page's own route), not a hand-built
  // `pathFromRoot`, so a narrowing to `route.paramMap` would fail here.
  describe('isOrgAddressed', () => {
    @Component({ selector: 'lfx-org-lens-nav-spec-page', template: '' })
    class Page {}

    async function leafSnapshotAt(url: string): Promise<ActivatedRouteSnapshot> {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([
            {
              path: 'company',
              children: [
                { path: 'easycla/:claGroupId', component: Page },
                { path: `:${ORG_SEGMENT_PARAM}`, children: [{ path: 'easycla/:claGroupId', component: Page }] },
              ],
            },
          ]),
          { provide: AccountContextService, useValue: { selectedAccount, selectedUrlSegment } },
        ],
      });
      const realRouter = TestBed.inject(Router);
      await realRouter.navigateByUrl(url);
      let leaf = realRouter.routerState.snapshot.root;
      while (leaf.firstChild) leaf = leaf.firstChild;
      return leaf;
    }

    it('is true under /company/:orgSegment/easycla/…', async () => {
      const leaf = await leafSnapshotAt('/company/acme-inc/easycla/abc-123');
      expect(TestBed.inject(OrgLensNavigationService).isOrgAddressed(leaf)).toBe(true);
    });

    it('is false on the leftover /company/easycla/… mount', async () => {
      const leaf = await leafSnapshotAt('/company/easycla/abc-123');
      expect(TestBed.inject(OrgLensNavigationService).isOrgAddressed(leaf)).toBe(false);
    });
  });
});
