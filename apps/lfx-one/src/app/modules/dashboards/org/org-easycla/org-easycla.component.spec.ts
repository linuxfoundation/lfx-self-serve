// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { OrgClaGroup } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { OrgNavigationService } from '@shared/services/org-navigation.service';
// The no-access branch renders a `lfxOpenIntercom` support button, which injects MessageService.
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaComponent } from './org-easycla.component';

describe('OrgEasyclaComponent', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000Te2ovAAB', accountName: 'Vertex Robotics' };

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(null);
  const hasOrgSelectorAccess = signal(true);
  const grantsLoaded = signal(true);
  const personaLoaded = signal(true);
  const navLoaded = signal(true);

  const getClaGroups = vi.fn();

  function claGroup(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupName: 'Nimbus Foundation CLA',
      claGroupId: 'cla-group-uuid-1',
      foundationName: 'Nimbus Foundation',
      projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
      status: 'signed',
      needsClaManager: false,
      claManagersCount: 2,
      ...overrides,
    };
  }

  /** Eight fills exactly one page; anything past that is on page two. */
  function manyClaGroups(count: number): OrgClaGroup[] {
    return Array.from({ length: count }, (_, index) =>
      claGroup({ id: `signature-${index}`, claGroupName: `Foundation ${index} CLA`, projects: [{ projectName: `Project ${index}` }] })
    );
  }

  async function render(): Promise<ComponentFixture<OrgEasyclaComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess } },
        { provide: OrgRoleGrantsService, useValue: { loaded: grantsLoaded } },
        { provide: PersonaService, useValue: { personaLoaded } },
        { provide: OrgNavigationService, useValue: { loaded: navLoaded } },
        { provide: OrgLensClaService, useValue: { getClaGroups } },
        MessageService,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function byTestId(fixture: ComponentFixture<OrgEasyclaComponent>, id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  function allByTestId(fixture: ComponentFixture<OrgEasyclaComponent>, id: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${id}"]`));
  }

  async function search(fixture: ComponentFixture<OrgEasyclaComponent>, term: string): Promise<void> {
    fixture.componentInstance['filterForm'].controls.search.setValue(term);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    selectedAccount.set(SELECTED_ACCOUNT);
    hasOrgSelectorAccess.set(true);
    grantsLoaded.set(true);
    personaLoaded.set(true);
    navLoaded.set(true);
    getClaGroups.mockReset();
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [] }));
  });

  describe('page chrome', () => {
    // Matches the sibling org-lens pages (memberships, projects) and the approved M3 design,
    // which titles the page "EasyCLA — {Company}".
    it('titles the page with the selected company', async () => {
      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-title')?.textContent).toContain('EasyCLA');
      expect(byTestId(fixture, 'org-easycla-title')?.textContent).toContain('Vertex Robotics');
    });

    it('falls back to the bare title before an account resolves', async () => {
      selectedAccount.set(null);

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-title')?.textContent).toContain('EasyCLA');
      expect(byTestId(fixture, 'org-easycla-title')?.textContent).not.toContain('—');
    });

    it('renders the Sign CLA control, disabled, so the empty-state copy points at something real', async () => {
      const fixture = await render();
      const signCla = byTestId(fixture, 'org-easycla-sign-cla');

      expect(signCla).toBeTruthy();
      expect(signCla?.querySelector('button')?.disabled).toBe(true);
    });
  });

  describe('access and org-selection states', () => {
    // The route guard only checks the dark-launch flag, so the component owns the access answer.
    // Telling an unauthorized caller "No CLAs signed yet" would describe their CLAs rather than
    // their access, and imply the org has none.
    it('says the lens is unavailable, not that no CLAs exist, when the caller holds no org access', async () => {
      hasOrgSelectorAccess.set(false);

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-no-access-state')).toBeTruthy();
      expect(byTestId(fixture, 'org-easycla-empty-state')).toBeNull();
    });

    it('withholds both answers until the grant and persona fetches have returned', async () => {
      hasOrgSelectorAccess.set(false);
      grantsLoaded.set(false);

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-loading')).toBeTruthy();
      expect(byTestId(fixture, 'org-easycla-no-access-state')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-empty-state')).toBeNull();
    });

    // Grants and personas can settle while the org list is still being fetched and default-selected,
    // so an authorized user would otherwise be told they have no CLAs before a company existed.
    it('keeps waiting while the org list is still resolving, even with grants and personas settled', async () => {
      navLoaded.set(false);
      selectedAccount.set(null);

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-loading')).toBeTruthy();
      expect(byTestId(fixture, 'org-easycla-empty-state')).toBeNull();
    });

    // LF staff satisfy hasOrgSelectorAccess with an empty account list, so "no CLAs signed yet" would
    // be a claim about an organization they have not picked.
    it('asks for an organization rather than reporting no CLAs when none is selected', async () => {
      selectedAccount.set(null);

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-no-company-empty-state')).toBeTruthy();
      expect(byTestId(fixture, 'org-easycla-empty-state')).toBeNull();
      expect(getClaGroups).not.toHaveBeenCalled();
    });
  });

  describe('the list', () => {
    it('renders one card per agreement', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ id: 'a' }), claGroup({ id: 'b' }), claGroup({ id: 'c' })] }));

      const fixture = await render();

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(3);
      expect(byTestId(fixture, 'org-easycla-empty-state')).toBeNull();
    });

    it('fetches once for the selected organization', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup()] }));

      await render();

      expect(getClaGroups).toHaveBeenCalledTimes(1);
      expect(getClaGroups).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid);
    });
  });

  describe('empty states', () => {
    it('names the organization when it has signed nothing', async () => {
      const fixture = await render();
      const empty = byTestId(fixture, 'org-easycla-empty-state');

      expect(empty).toBeTruthy();
      expect(empty?.textContent).toContain("Vertex Robotics hasn't signed any CLAs yet");
      expect(empty?.textContent).toContain('Sign CLA');
    });

    it('says no matches — not "signed nothing" — when a search excludes everything', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup()] }));

      const fixture = await render();
      await search(fixture, 'zzzzz');

      expect(byTestId(fixture, 'org-easycla-no-matches-state')).toBeTruthy();
      expect(byTestId(fixture, 'org-easycla-empty-state')).toBeNull();
    });

    it('never shows both empty states at once', async () => {
      const fixture = await render();
      await search(fixture, 'zzzzz');

      // Nothing signed AND a search that matches nothing: only the "signed nothing" answer is true.
      expect(byTestId(fixture, 'org-easycla-empty-state')).toBeTruthy();
      expect(byTestId(fixture, 'org-easycla-no-matches-state')).toBeNull();
    });

    // The toolbar not collapsing with the list is what lets a viewer revise a failed search or
    // start a first agreement without reloading the page.
    it('keeps the search box and Sign CLA control visible in both empty states', async () => {
      const noneSigned = await render();

      expect(byTestId(noneSigned, 'org-easycla-toolbar')).toBeTruthy();
      expect(byTestId(noneSigned, 'org-easycla-sign-cla')).toBeTruthy();

      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup()] }));
      const noMatches = await render();
      await search(noMatches, 'zzzzz');

      expect(byTestId(noMatches, 'org-easycla-no-matches-state')).toBeTruthy();
      expect(byTestId(noMatches, 'org-easycla-toolbar')).toBeTruthy();
      expect(byTestId(noMatches, 'org-easycla-sign-cla')).toBeTruthy();
    });

    // Upstream returns an empty list both for an org with no agreements and for one it has no
    // record of, so a failure degraded to an empty list would be indistinguishable from "you have
    // signed nothing" — a false statement about the company's legal position.
    it('reports a failed load as a failure, not as an empty list', async () => {
      getClaGroups.mockReturnValue(throwError(() => new Error('upstream exploded')));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-error-state')).toBeTruthy();
      expect(byTestId(fixture, 'org-easycla-empty-state')).toBeNull();
      consoleError.mockRestore();
    });
  });

  describe('search', () => {
    beforeEach(() => {
      getClaGroups.mockReturnValue(
        of({
          orgUid: SELECTED_ACCOUNT.uid,
          claGroups: [
            claGroup({ id: 'a', claGroupName: 'Nimbus Foundation CLA', foundationName: 'Nimbus Foundation', projects: [{ projectName: 'Cascade' }] }),
            claGroup({ id: 'b', claGroupName: 'Alder Project CLA', foundationName: 'Alder Foundation', projects: [{ projectName: 'Driftwood' }] }),
          ],
        })
      );
    });

    it('matches on the CLA Group name', async () => {
      const fixture = await render();
      await search(fixture, 'nimbus foundation cla');

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(1);
    });

    it('matches on the foundation name', async () => {
      const fixture = await render();
      await search(fixture, 'Alder Foundation');

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(1);
    });

    it('matches on a covered project name', async () => {
      const fixture = await render();
      await search(fixture, 'driftwood');

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(1);
    });

    it('ignores case and surrounding whitespace', async () => {
      const fixture = await render();
      await search(fixture, '   CASCADE   ');

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(1);
    });

    it('restores every card when the query is cleared', async () => {
      const fixture = await render();
      await search(fixture, 'cascade');
      await search(fixture, '');

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(2);
    });

    it('does not re-fetch while searching', async () => {
      const fixture = await render();
      await search(fixture, 'cascade');
      await search(fixture, 'driftwood');

      expect(getClaGroups).toHaveBeenCalledTimes(1);
    });
  });

  describe('paging', () => {
    it('hides the pager when everything fits on one page', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: manyClaGroups(8) }));

      const fixture = await render();

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(8);
      expect(byTestId(fixture, 'org-easycla-pager')).toBeNull();
    });

    it('pages at eight and reports the range of the total', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: manyClaGroups(11) }));

      const fixture = await render();

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(8);
      expect(byTestId(fixture, 'org-easycla-page-label')?.textContent).toContain('Showing 1–8 of 11');
    });

    it('moves to the next page without re-fetching', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: manyClaGroups(11) }));

      const fixture = await render();
      fixture.componentInstance['changePage'](1);
      fixture.detectChanges();

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(3);
      expect(byTestId(fixture, 'org-easycla-page-label')?.textContent).toContain('Showing 9–11 of 11');
      expect(getClaGroups).toHaveBeenCalledTimes(1);
    });

    // Without this a viewer who narrows while on page two lands on an empty page of a non-empty
    // result set, which reads as "no matches" while matches exist.
    it('returns to the first page when the query changes', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: manyClaGroups(11) }));

      const fixture = await render();
      fixture.componentInstance['changePage'](1);
      fixture.detectChanges();
      await search(fixture, 'Project');

      expect(byTestId(fixture, 'org-easycla-page-label')?.textContent).toContain('Showing 1–8 of 11');
    });
  });

  // The component survives an org switch, so every piece of state keyed to the previous company
  // has to be dropped by hand. What makes this more than a tidiness concern is the subject matter:
  // one company's agreements shown under another company's name is a false claim about who has
  // signed what.
  describe('switching organizations', () => {
    const OTHER_ACCOUNT = { uid: '0014100000Zq8xbAAB', accountName: 'Halcyon Systems' };

    async function switchOrg(fixture: ComponentFixture<OrgEasyclaComponent>): Promise<void> {
      selectedAccount.set(OTHER_ACCOUNT);
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it("drops the previous organization's cards while the new request is in flight", async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: manyClaGroups(3) }));
      const fixture = await render();
      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(3);

      getClaGroups.mockReturnValue(new Subject());
      await switchOrg(fixture);

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(0);
      expect(byTestId(fixture, 'org-easycla-list-loading')).not.toBeNull();
    });

    it('does not claim the new organization has signed nothing before its response lands', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [] }));
      const fixture = await render();
      expect(byTestId(fixture, 'org-easycla-empty-state')).not.toBeNull();

      getClaGroups.mockReturnValue(new Subject());
      await switchOrg(fixture);

      expect(byTestId(fixture, 'org-easycla-empty-state')).toBeNull();
    });

    it("shows the new organization's agreements once they arrive", async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: manyClaGroups(3) }));
      const fixture = await render();

      getClaGroups.mockReturnValue(of({ orgUid: OTHER_ACCOUNT.uid, claGroups: manyClaGroups(5) }));
      await switchOrg(fixture);

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(5);
      expect(getClaGroups).toHaveBeenLastCalledWith(OTHER_ACCOUNT.uid);
    });

    // A query aimed at the previous company would otherwise hide the new company's agreements
    // behind the no-matches state, which reads as "this company has none".
    it('clears a search carried over from the previous organization', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: manyClaGroups(3) }));
      const fixture = await render();
      await search(fixture, 'Foundation 0');
      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(1);

      getClaGroups.mockReturnValue(of({ orgUid: OTHER_ACCOUNT.uid, claGroups: manyClaGroups(3) }));
      await switchOrg(fixture);

      expect(fixture.componentInstance['filterForm'].controls.search.value).toBe('');
      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(3);
    });

    it("opens the new organization's list at the first page", async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: manyClaGroups(11) }));
      const fixture = await render();
      fixture.componentInstance['changePage'](1);
      fixture.detectChanges();

      getClaGroups.mockReturnValue(of({ orgUid: OTHER_ACCOUNT.uid, claGroups: manyClaGroups(11) }));
      await switchOrg(fixture);

      expect(byTestId(fixture, 'org-easycla-page-label')?.textContent).toContain('Showing 1–8 of 11');
    });
  });
});
