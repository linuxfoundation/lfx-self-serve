// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ApplicationRef, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ORG_CLA_SIGNED_SIGNATURE_KEY } from '@lfx-one/shared/constants';
import type { Account, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { OrgNavigationService } from '@shared/services/org-navigation.service';
// The no-access branch renders a `lfxOpenIntercom` support button, which injects MessageService.
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaCoverageDialogComponent } from './org-easycla-coverage-dialog/org-easycla-coverage-dialog.component';
import { OrgEasyclaComponent } from './org-easycla.component';

describe('OrgEasyclaComponent', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000Te2ovAAB', accountName: 'Vertex Robotics' };

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(null);
  const hasOrgSelectorAccess = signal(true);
  const grantsLoaded = signal(true);
  const personaLoaded = signal(true);
  const navLoaded = signal(true);

  const getClaGroups = vi.fn();
  const openDialog = vi.fn();

  function claGroup(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupName: 'Nimbus Foundation CLA',
      claGroupId: 'cla-group-uuid-1',
      foundationName: 'Nimbus Foundation',
      projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
      signed: true,
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
        { provide: OrgNavigationService, useValue: { loaded: navLoaded, resetAndReload: vi.fn() } },
        { provide: OrgLensClaService, useValue: { getClaGroups } },
        MessageService,
      ],
    }).compileComponents();

    // Component-level `providers` win over TestBed's, so the dialog is stubbed the same way the
    // detail spec stubs it — by overriding the component's own provider.
    TestBed.overrideComponent(OrgEasyclaComponent, {
      set: { providers: [{ provide: DialogService, useValue: { open: openDialog } }] },
    });

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
    openDialog.mockReset();
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

    it('offers the Sign CLA control once an organization is selected', async () => {
      const fixture = await render();
      const signCla = byTestId(fixture, 'org-easycla-sign-cla');

      expect(signCla).toBeTruthy();
      expect(signCla?.querySelector('button')?.disabled).toBe(false);
    });

    it('cannot be used before an organization resolves, because there is nothing to sign for', async () => {
      selectedAccount.set(null);

      const fixture = await render();

      const button = byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button');
      expect(button?.disabled).toBe(true);
      // A disabled control must say why, or a screen reader hears only "disabled".
      expect(button?.getAttribute('aria-label')).toContain('select an organization first');
    });

    // `hasNoOrgAccess()` reads false while the grants and persona are still resolving, so without
    // this gate a viewer holding no grant can start the flow inside the loading window and reach a
    // refusal the page would otherwise have prevented.
    it('cannot be used while the organization context is still resolving', async () => {
      grantsLoaded.set(false);

      const fixture = await render();

      const button = byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button');
      expect(button?.disabled).toBe(true);
      // Every reason the control is disabled needs its own wording, or the announcement is just
      // "disabled" with nothing behind it.
      expect(button?.getAttribute('aria-label')).toContain('checking your organization access');
    });

    /**
     * The picker greys out the agreements the organization already holds, and it does that from
     * this page's list. Before the list lands that is `[]`, indistinguishable from holding nothing,
     * so a picker opened early offers a held agreement as choosable — and choosing it opens a
     * second DocuSign envelope against an agreement already signed.
     */
    it('cannot be used before the organization’s own agreements have loaded', async () => {
      getClaGroups.mockReturnValue(NEVER);

      const fixture = await render();

      const button = byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button');
      expect(button?.disabled).toBe(true);
      expect(button?.getAttribute('aria-label')).toContain('loading the agreements this organization already holds');
    });

    // A failed load is the same case with no recovery: there is no list to check a choice against,
    // so the control says so rather than checking against nothing.
    it('cannot be used when the organization’s agreements failed to load', async () => {
      getClaGroups.mockReturnValue(throwError(() => new Error('boom')));

      const fixture = await render();

      const button = byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button');
      expect(button?.disabled).toBe(true);
      expect(button?.getAttribute('aria-label')).toContain('could not be loaded');
    });

    // Not disabled for a viewer who lacks signing authority. The CLA service decides that per
    // project and organization and explains its refusal in words; this layer cannot know it, and
    // guessing would hide the control from people who do hold the authority.
    it('offers the control without pre-judging the viewer’s signing authority', async () => {
      const fixture = await render();
      const button = byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button');

      expect(button?.disabled).toBe(false);
      expect(button?.getAttribute('aria-label')).toBe('Sign a corporate CLA');
    });
  });

  // The component's own job in the signing flow is only to sequence three dialogs and carry each
  // one's result to the next. What is worth proving is that it carries rather than reconstructs:
  // the attestations reaching the hand-off must be the ones the attestation dialog closed with.
  /**
   * The picker, and the hand-over to the preview page.
   *
   * This page's part of the signing flow ends at the choice. The attestation and the hand-off belong
   * to the preview the choice is carried to — that is the arrangement the M3 prototype draws, and it
   * puts the two legally operative steps on a page that names the agreement they apply to.
   */
  describe('corporate signing flow', () => {
    const chosen = { claGroupId: 'cla-group-uuid-1', projectSfid: 'a09410000182dD2AAI', projectName: 'Cascade', claGroupName: 'Cascade CLA' };

    /** Only the four the flow actually sets. The rest of DynamicDialogConfig is PrimeNG's default. */
    interface DialogHarnessConfig {
      data?: unknown;
      closable?: boolean;
      closeOnEscape?: boolean;
      dismissableMask?: boolean;
    }

    /** Each `open` closes with the next queued result, so a whole flow can be driven in order. */
    function dialogHarness(closeResults: unknown[]) {
      const opened: { component: unknown; config: DialogHarnessConfig }[] = [];
      const open = vi.fn((component: unknown, config: DialogHarnessConfig = {}) => {
        opened.push({ component, config });
        const result = closeResults[opened.length - 1];
        // `onDestroy` as well as `onClose`: the navigation waits for teardown, so a stub that only
        // closes would never reach it.
        return { onClose: of(result), onDestroy: of(undefined), close: vi.fn() };
      });
      return { opened, open };
    }

    async function renderWithDialogs(closeResults: unknown[]) {
      const harness = dialogHarness(closeResults);
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [OrgEasyclaComponent],
        providers: [
          provideRouter([]),
          provideNoopAnimations(),
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
          { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess } },
          { provide: OrgRoleGrantsService, useValue: { loaded: grantsLoaded } },
          { provide: PersonaService, useValue: { personaLoaded } },
          { provide: OrgNavigationService, useValue: { loaded: navLoaded, resetAndReload: vi.fn() } },
          { provide: OrgLensClaService, useValue: { getClaGroups } },
          MessageService,
        ],
      })
        // The component provides DialogService itself, so the component-level provider is the one
        // that has to be replaced; a module-level override would not be seen.
        .overrideComponent(OrgEasyclaComponent, { set: { providers: [{ provide: DialogService, useValue: { open: harness.open } }] } })
        .compileComponents();

      // The test module declares no routes, so a real navigation would resolve to nothing and the
      // assertion would be about the router's failure rather than about where the page tried to go.
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      const fixture = TestBed.createComponent(OrgEasyclaComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return { fixture, harness, navigate };
    }

    it('asks which CLA group to sign for, scoped to the selected organization', async () => {
      const { fixture, harness } = await renderWithDialogs([null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened).toHaveLength(1);
      expect(harness.opened[0].config.data).toEqual({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [] });
    });

    /**
     * The picker refuses a CLA Group the organization already holds an agreement for, and this is
     * where it learns which those are.
     *
     * Handed down rather than fetched: this page has the list on screen, and a second request would
     * be a second answer to the same question. Nothing else here can supply it, so an omission is
     * silent — the picker simply refuses nothing and the preview goes on to tell the signatory their
     * organization has not signed an agreement it has.
     */
    it('hands the picker the agreements the organization already holds', async () => {
      const groups = [claGroup()];
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: groups }));
      const { fixture, harness } = await renderWithDialogs([null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened[0].config.data).toEqual({ orgUid: SELECTED_ACCOUNT.uid, claGroups: groups });
    });

    /**
     * Keyed on the `orgUid` the server echoed, not on a response merely being in hand.
     *
     * The previous organization's list stays loaded for a cycle after a switch. Opening the picker
     * against it would either refuse rows this organization never signed, or — passing the empty
     * list instead — offer one it already holds, which starts a second envelope against a signed
     * agreement. Neither is discoverable by the viewer, so the control waits for the real list.
     */
    it('does not offer the control while the list in hand belongs to a different organization', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: '0014100000Zq8xbAAB', claGroups: [claGroup()] }));
      const { fixture, harness } = await renderWithDialogs([null]);

      const button = byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button');
      expect(button?.disabled).toBe(true);

      button?.click();
      expect(harness.opened).toHaveLength(0);
    });

    /**
     * The hand-over, and the load-bearing one on this page.
     *
     * The choice travels in the navigation's state rather than the address, because an address holds
     * nothing that could be resolved: there is no fetch-a-CLA-group-by-id endpoint, so the preview
     * would have to render its heading from text taken out of the URL. Everything the preview needs
     * has to be in this object, including the display name — a selection missing one of these fields
     * is one the preview refuses and redirects away from.
     */
    it('carries the choice to the preview page in the navigation state', async () => {
      const { fixture, navigate } = await renderWithDialogs([chosen]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      // The key is spelled out rather than taken from the constant, deliberately. It is written into
      // a history entry that outlives the deployment that wrote it, so renaming it silently breaks
      // in-app back and forward into a preview opened before the deploy.
      expect(navigate).toHaveBeenCalledWith(['/org/easycla', 'new'], { state: { orgClaSignSelection: chosen } });
    });

    it('goes nowhere when no CLA group was chosen', async () => {
      const { fixture, harness, navigate } = await renderWithDialogs([null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();
    });

    // Only the picker. The attestation and the hand-off are the preview page's, so a second dialog
    // opened here would be this page running a flow it no longer owns.
    it('opens no dialog of its own beyond the picker', async () => {
      const { fixture, harness } = await renderWithDialogs([chosen]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened).toHaveLength(1);
    });

    // Freely dismissable: nothing has been created yet, and trapping someone in a legal
    // confirmation they want to back out of would be its own problem.
    it('leaves the CLA group picker dismissable, because nothing exists yet to lose', async () => {
      const { fixture, harness } = await renderWithDialogs([chosen]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened[0].config.closable).toBe(true);
    });

    // A dismissed flow must release the control, or the page needs a reload to try again.
    it('offers the control again after a dismissed flow', async () => {
      const { fixture } = await renderWithDialogs([null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();
      fixture.detectChanges();

      expect(byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.disabled).toBe(false);
    });

    /**
     * The lock spans the navigation, not just the dialog.
     *
     * Between the picker tearing down and the preview being reached the control is on screen and
     * live, so releasing at the close would let a second click start a parallel flow in that gap.
     * Releasing at the navigation instead also covers the case where it never lands — refused by a
     * guard, or superseded — which would otherwise leave Sign CLA disabled until a reload.
     */
    it('holds the control through the navigation and releases it when that settles', async () => {
      const { fixture, navigate } = await renderWithDialogs([chosen]);
      let arrive: (landed: boolean) => void = () => undefined;
      navigate.mockReturnValue(new Promise<boolean>((resolve) => (arrive = resolve)));

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();
      fixture.detectChanges();
      const control = (): HTMLButtonElement | null | undefined => byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button');
      expect(control()?.disabled).toBe(true);

      // Refused, which is the case the release has to cover: on a landing navigation this page is
      // already gone and nothing here would be observable either way.
      arrive(false);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(control()?.disabled).toBe(false);
    });

    /**
     * Switching organizations with the picker part-way open.
     *
     * These need a dialog that stays open, so they use a harness whose `onClose` is a Subject the
     * test controls. The one above emits synchronously, which closes the dialog the instant it opens
     * — fine for asserting what gets passed along, useless for asserting what happens while it is
     * still standing.
     */
    describe('when the organization changes part-way through', () => {
      interface OpenDialog {
        component: unknown;
        config: DialogHarnessConfig;
        close: ReturnType<typeof vi.fn>;
        /** Emit to drive this dialog's own close, which is how the flow advances a step. */
        onClose: Subject<unknown>;
        /** Emit after `onClose` to finish the leave animation. The next step waits on this. */
        onDestroy: Subject<void>;
      }

      function openDialogHarness() {
        const opened: OpenDialog[] = [];
        const open = vi.fn((component: unknown, config: DialogHarnessConfig = {}) => {
          const dialog: OpenDialog = { component, config, close: vi.fn(), onClose: new Subject<unknown>(), onDestroy: new Subject<void>() };
          opened.push(dialog);
          return { onClose: dialog.onClose, onDestroy: dialog.onDestroy, close: dialog.close };
        });
        return { opened, open };
      }

      async function renderWithOpenDialogs() {
        const harness = openDialogHarness();
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
          imports: [OrgEasyclaComponent],
          providers: [
            provideRouter([]),
            provideNoopAnimations(),
            { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess } },
            { provide: OrgRoleGrantsService, useValue: { loaded: grantsLoaded } },
            { provide: PersonaService, useValue: { personaLoaded } },
            { provide: OrgNavigationService, useValue: { loaded: navLoaded, resetAndReload: vi.fn() } },
            { provide: OrgLensClaService, useValue: { getClaGroups } },
            MessageService,
          ],
        })
          .overrideComponent(OrgEasyclaComponent, { set: { providers: [{ provide: DialogService, useValue: { open: harness.open } }] } })
          .compileComponents();

        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

        const fixture = TestBed.createComponent(OrgEasyclaComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return { fixture, harness, navigate };
      }

      /**
       * The load-bearing one, and the reason the close exists at all.
       *
       * `orgUid` is read once when the flow starts and handed to the picker as dialog data, and
       * switching organizations does not destroy this component. So a picker left standing lists
       * the previous organization's CLA groups, and choosing one would carry that company into a
       * signing session for the one the viewer is now looking at — the detail page's stale-download
       * failure, arriving at a corporate legal agreement instead of a PDF.
       */
      it('closes the CLA group picker rather than letting it sign for the organization just left', async () => {
        const { fixture, harness } = await renderWithOpenDialogs();

        byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();
        expect(harness.opened).toHaveLength(1);

        selectedAccount.set({ uid: '0014100000Te2QjAAJ', accountName: 'Meridian Systems' });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(harness.opened[0].close).toHaveBeenCalled();
      });

      /**
       * Clearing the organization, not just switching to another one.
       *
       * This is the half the detail page's download stream originally missed: the cancellation
       * derived from the non-empty selection, so clearing emitted nothing and the stale request
       * survived. The same filter sits in this component's `orgUid$`, which is why the signing
       * close listens on the unfiltered stream instead. Without that, this case leaves a picker
       * open over a page showing no organization at all.
       */
      it('closes the picker when the organization is cleared, not only when it is switched', async () => {
        const { fixture, harness } = await renderWithOpenDialogs();

        byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();
        expect(harness.opened).toHaveLength(1);

        selectedAccount.set(null);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(harness.opened[0].close).toHaveBeenCalled();
      });

      /**
       * The navigation waits for the picker to be torn down, not merely closed.
       *
       * `close()` emits `onClose` synchronously and starts the leave animation from that same
       * emission, and the end of that animation drops `p-overflow-hidden` from the body. Leaving
       * from inside `onClose` therefore races that teardown against a page change, and the Me-lens
       * hand-off found the dialog half of this first (#2066).
       */
      it('does not leave for the preview until the picker has torn down', async () => {
        const { fixture, harness, navigate } = await renderWithOpenDialogs();

        byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

        harness.opened[0].onClose.next(chosen);
        expect(navigate).not.toHaveBeenCalled();

        harness.opened[0].onDestroy.next();
        expect(navigate).toHaveBeenCalledTimes(1);
      });

      /**
       * PrimeNG's header X and Escape go through `p-dialog` `onHide` → `destroy()`, never `close()`.
       * `onClose` therefore never fires. The lock has to drop on that teardown, or Sign CLA stays
       * disabled until reload.
       */
      it('offers the control again after the header close tears the dialog down without onClose', async () => {
        const { fixture, harness } = await renderWithOpenDialogs();

        byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();
        fixture.detectChanges();
        expect(byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.disabled).toBe(true);

        harness.opened[0].onDestroy.next();
        fixture.detectChanges();

        expect(byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.disabled).toBe(false);
      });

      // The gap between the picker tearing down and the preview being reached is a window in which
      // the control is live. It stays disabled across it, or a second click opens a second picker.
      it('starts no second flow in the gap between the teardown and the navigation', async () => {
        const { fixture, harness } = await renderWithOpenDialogs();

        byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();
        harness.opened[0].onClose.next(chosen);

        byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();
        harness.opened[0].onDestroy.next();

        expect(harness.opened).toHaveLength(1);
      });
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

    /**
     * The organization stays selected here on purpose.
     *
     * That combination is what the page actually renders for a caller whose account carries a
     * company but no Org Lens grant, and it is the one the other no-access cases miss by clearing
     * `selectedAccount` — which disables the control for the unrelated reason that there is
     * nothing to sign for. With the company left in place, only an access term can disable it.
     * Without one, the page offered "Organization Lens is not available" and a live Sign CLA
     * button together, and every request the flow made would be refused by the server.
     */
    it('does not offer Sign CLA to a caller with a company but no org access', async () => {
      hasOrgSelectorAccess.set(false);

      const fixture = await render();

      const button = byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button');
      expect(button?.disabled).toBe(true);
      expect(button?.getAttribute('aria-label')).toContain('Organization Lens is not available');
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
      const link = byTestId(fixture, 'org-easycla-card-link') as HTMLAnchorElement | null;
      expect(link?.getAttribute('href')).toContain('/org/easycla/a');
    });

    it('overlays the card link rather than wrapping the card in it', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ needsClaManager: true, claManagersCount: 0 })] }));

      const fixture = await render();
      const link = byTestId(fixture, 'org-easycla-card-link') as HTMLAnchorElement;

      // The "Needs a CLA Manager" tag carries a tooltip and so takes `tabindex="0"`. Inside the
      // anchor it would be a second tab stop within the link, and a click on it would be
      // ambiguous with following the agreement.
      expect(link.querySelector('[data-testid="org-easycla-card"]')).toBeNull();
      expect(link.querySelector('[tabindex]')).toBeNull();
      expect(link.getAttribute('aria-label')).toBe('Open Nimbus Foundation CLA');

      // Layering per the me-selector in sidebar.component.html: the anchor sits beneath the card,
      // the card's content has pointer events off so a click anywhere reaches the link, and the
      // tooltip'd tag re-enables them so hovering it still opens the tooltip.
      const card = byTestId(fixture, 'org-easycla-card') as HTMLElement;
      expect(card.closest('.pointer-events-none')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-card-needs-manager')?.querySelector('.pointer-events-auto')).not.toBeNull();
    });

    // The card shows the signing entity as a visible subline precisely because the CLA Group name is
    // not unique — an organization signing under several entities gets one row per entity. A link
    // naming only the group reproduces on the accessibility tree the ambiguity the subline resolves
    // on screen, leaving two identical "Open …" links.
    it('distinguishes the links of two rows that share a CLA Group name', async () => {
      getClaGroups.mockReturnValue(
        of({
          orgUid: SELECTED_ACCOUNT.uid,
          claGroups: [claGroup({ id: 'a', signingEntityName: 'Acme Motors GmbH' }), claGroup({ id: 'b', signingEntityName: 'Acme Robotics Ltd' })],
        })
      );

      const fixture = await render();
      const labels = allByTestId(fixture, 'org-easycla-card-link').map((link) => link.getAttribute('aria-label'));

      expect(labels).toEqual(['Open Nimbus Foundation CLA, Acme Motors GmbH', 'Open Nimbus Foundation CLA, Acme Robotics Ltd']);
      expect(new Set(labels).size).toBe(2);
    });

    it('shows what a row covers without leaving the list', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup()] }));

      const fixture = await render();
      (byTestId(fixture, 'org-easycla-card-coverage-link') as HTMLButtonElement | null)?.click();
      fixture.detectChanges();

      expect(openDialog).toHaveBeenCalledWith(
        OrgEasyclaCoverageDialogComponent,
        expect.objectContaining({
          header: 'Projects covered by Nimbus Foundation CLA',
          data: {
            claGroupName: 'Nimbus Foundation CLA',
            foundationName: 'Nimbus Foundation',
            projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
          },
        })
      );
    });

    // The rows share a CLA Group name and differ only in coverage, which is exactly the case an
    // id lookup or a shared handler would get wrong: the dialog must describe the row clicked.
    it('opens the dialog for the row whose chip was activated, not the first one', async () => {
      getClaGroups.mockReturnValue(
        of({
          orgUid: SELECTED_ACCOUNT.uid,
          claGroups: [
            claGroup({ id: 'a', projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }] }),
            claGroup({ id: 'b', projects: [{ projectName: 'Fathom' }, { projectName: 'Gantry' }, { projectName: 'Halyard' }] }),
          ],
        })
      );

      const fixture = await render();
      const chips = allByTestId(fixture, 'org-easycla-card-coverage-link');
      expect(chips).toHaveLength(2);

      (chips[1] as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(openDialog).toHaveBeenCalledOnce();
      expect(openDialog.mock.calls[0][1].data.projects).toEqual([{ projectName: 'Fathom' }, { projectName: 'Gantry' }, { projectName: 'Halyard' }]);
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

    // On the failure state there is nothing loaded to filter, and the no-matches state cannot fire,
    // so the box would accept input and change nothing — a second, unexplained fault on a page that
    // has already told the viewer what went wrong.
    it('withholds the search box on the failure state, where it could filter nothing', async () => {
      getClaGroups.mockReturnValue(throwError(() => new Error('upstream exploded')));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-toolbar')).toBeNull();
      // Sign CLA is in the header rather than the toolbar, so the failure state does not take it.
      expect(byTestId(fixture, 'org-easycla-sign-cla')).toBeTruthy();
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

    // `companyName()` reacts to the account signal in the same pass, while the response in hand is
    // still the previous organization's, so timing alone does not hold the invariant. Rows are
    // gated on the orgUid the server echoed matching the organization the header names — and the
    // gate holds the loading state rather than emptying the list, because an empty list on a
    // settled page is not neutral, it is the "hasn't signed any CLAs yet" claim.
    it("withholds a response carrying another organization's uid", async () => {
      getClaGroups.mockReturnValue(of({ orgUid: OTHER_ACCOUNT.uid, claGroups: manyClaGroups(3) }));

      const fixture = await render();

      expect(allByTestId(fixture, 'org-easycla-card')).toHaveLength(0);
      expect(byTestId(fixture, 'org-easycla-empty-state')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-list-loading')).toBeTruthy();
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
  /**
   * Returning from DocuSign, where the organization is named on the address.
   *
   * The signatory comes back through a cross-site navigation carrying only a `SameSite=Lax`
   * cookie; when it does not come back, bootstrap selects the first organization in their list, so
   * signing for one company returns them looking at another.
   */
  describe('when EasyCLA returns the signatory with an organization named on the address', () => {
    const MICROSOFT = { uid: '0014100000Te0OKAAZ', accountName: 'Microsoft Corporation', accountId: 'acct-microsoft' };
    const CONTAINERSHIP = { uid: '0014100000Te2QjAAJ', accountName: 'ContainerShip, Inc.', accountId: 'acct-containership' };

    async function renderReturnedFrom(namedOrg: string | null, authorized: Partial<Account>[] = [CONTAINERSHIP, MICROSOFT]) {
      const setAccount = vi.fn();
      const resetAndReload = vi.fn();
      const navigate = vi.fn();
      const availableAccounts = signal(authorized);

      selectedAccount.set(CONTAINERSHIP);
      getClaGroups.mockReturnValue(of({ orgUid: CONTAINERSHIP.uid, claGroups: [] }));

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [OrgEasyclaComponent],
        providers: [
          provideRouter([]),
          provideNoopAnimations(),
          { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess, availableAccounts, setAccount } },
          { provide: OrgRoleGrantsService, useValue: { loaded: grantsLoaded } },
          { provide: PersonaService, useValue: { personaLoaded } },
          { provide: OrgNavigationService, useValue: { loaded: navLoaded, resetAndReload } },
          { provide: OrgLensClaService, useValue: { getClaGroups } },
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(namedOrg ? { org: namedOrg } : {}) } } },
          MessageService,
        ],
      })
        .overrideComponent(OrgEasyclaComponent, { set: { providers: [{ provide: DialogService, useValue: { open: openDialog } }] } })
        .compileComponents();

      const fixture = TestBed.createComponent(OrgEasyclaComponent);
      const router = TestBed.inject(Router);
      vi.spyOn(router, 'navigate').mockImplementation(navigate);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();

      return { fixture, setAccount, resetAndReload, navigate, availableAccounts };
    }

    it('selects the organization the signature was made for, not the first in the list', async () => {
      const { setAccount } = await renderReturnedFrom(MICROSOFT.uid);

      // `setAccount` also rewrites the cookie, so the selection that went missing is repaired.
      expect(setAccount).toHaveBeenCalledWith(MICROSOFT);
    });

    /**
     * The authorized list does not keep the shape it starts with. Persona seeds carry `uid`, and
     * each is then replaced by the Snowflake-enriched record for the same company, which carries
     * `accountId` and no `uid` — the two being the same Salesforce id for an organization account.
     * Recognising only the seed shape means the recognition expires partway through the page's own
     * bootstrap, and which side of that the return lands on is a race.
     *
     * The pinned `uid` is the other half: the enriched record has none, `setAccount` persists the
     * selection by it, and a selection saved without one clears the cookie the return exists to
     * repair.
     */
    it('selects the organization after its record has been enriched and no longer carries a uid', async () => {
      const enriched = { accountId: MICROSOFT.uid, accountName: MICROSOFT.accountName };

      const { setAccount, resetAndReload } = await renderReturnedFrom(MICROSOFT.uid, [CONTAINERSHIP, enriched]);

      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ accountName: MICROSOFT.accountName, uid: MICROSOFT.uid }));
      expect(resetAndReload).toHaveBeenCalledWith(MICROSOFT.uid);
    });

    /**
     * Selecting it is not enough to keep it.
     *
     * The org selector requests its first page for whichever organization was current at bootstrap,
     * which on a cold return is still the stale cookie. When that page lands, the pending default
     * selection reassigns to its first row unless the current selection is on it — so adopting
     * without re-pinning is overwritten a beat later by a page requested before the adoption
     * happened, and the signatory lands back on the organization they did not sign for.
     */
    it('re-pins the catalogue on the adopted organization, so the pending default selection cannot reassign it', async () => {
      const { resetAndReload } = await renderReturnedFrom(MICROSOFT.uid);

      expect(resetAndReload).toHaveBeenCalledWith(MICROSOFT.uid);
    });

    // The mirror of ignoring it above: an organization that was not adopted must not be pinned
    // either, or a crafted link would reorder the viewer's catalogue around a company it named.
    it('does not re-pin an organization the viewer does not hold', async () => {
      const { resetAndReload } = await renderReturnedFrom('0014100000TeZZZAAA');

      expect(resetAndReload).not.toHaveBeenCalled();
    });

    /**
     * The parameter names an organization; it does not grant one.
     *
     * A crafted link must not select a company the viewer does not hold — and specifically must
     * not render its name, which is what building a stub from the value (the way the cookie path
     * hydrates an id it trusts) would do.
     */
    it('ignores an organization the viewer does not hold rather than selecting it', async () => {
      const { setAccount, fixture } = await renderReturnedFrom('0014100000TeZZZAAA');

      expect(setAccount).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).not.toContain('0014100000TeZZZAAA');
    });

    it('strips the parameter once adopted, so a reload or a copied link cannot pin a stale organization', async () => {
      const { navigate } = await renderReturnedFrom(MICROSOFT.uid);

      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { org: null }, replaceUrl: true }));
    });

    // Left in place it would keep re-asserting an organization the viewer cannot have, on a page
    // that has already settled without it.
    it('strips the parameter even when it named an organization it could not use', async () => {
      const { navigate } = await renderReturnedFrom('0014100000TeZZZAAA');

      expect(navigate).toHaveBeenCalled();
    });

    /**
     * The strip and the landing on the signed agreement race each other — this one waits on the
     * authorized accounts, the other on the CLA list — and this one navigates *relative to this
     * route*. Arriving second, it would take the signatory straight back off the agreement they
     * had just been landed on, which reads as the landing being broken rather than the strip.
     *
     * There is nothing left to strip in that case either: the agreement's address carries no
     * parameter.
     */
    // The list arrives after this page is constructed, so resolving against the empty list it starts
    // with would throw away a legitimate hand-off.
    it('waits for the authorized list rather than discarding the hand-off against an empty one', async () => {
      navLoaded.set(false);
      const { setAccount, availableAccounts } = await renderReturnedFrom(MICROSOFT.uid, []);

      expect(setAccount).not.toHaveBeenCalled();

      availableAccounts.set([CONTAINERSHIP, MICROSOFT]);
      navLoaded.set(true);
      await TestBed.inject(ApplicationRef).whenStable();

      expect(setAccount).toHaveBeenCalledWith(MICROSOFT);
    });

    // The mirror of the wait above: once the organization list has genuinely settled without it,
    // there is nothing left to wait for and the page stops trying.
    it('gives up once the organization context has settled without that organization', async () => {
      const { setAccount, navigate } = await renderReturnedFrom(MICROSOFT.uid, []);

      expect(setAccount).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalled();
    });

    it('touches nothing on an ordinary visit that carries no organization', async () => {
      const { setAccount, navigate } = await renderReturnedFrom(null);

      expect(setAccount).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  /**
   * Landing on the agreement just signed, rather than on the list the signatory left.
   *
   * The return address cannot name it: `return_url` is an input to the upstream signing request and
   * so is fixed before a signature exists. The signature crosses in `sessionStorage` instead, and
   * this page spends it.
   */
  describe('when EasyCLA returns the signatory after a signing ceremony', () => {
    const SIGNED = ['/org/easycla', 'signature-uuid-1'];

    async function renderAfterSigning(options: { stash?: string; org?: string | null; listOrgUid?: string; claGroups?: OrgClaGroup[] } = {}) {
      const { stash = 'signature-uuid-1', org = SELECTED_ACCOUNT.uid, listOrgUid = SELECTED_ACCOUNT.uid, claGroups = [claGroup()] } = options;

      if (stash) sessionStorage.setItem(ORG_CLA_SIGNED_SIGNATURE_KEY, stash);
      selectedAccount.set(SELECTED_ACCOUNT);
      getClaGroups.mockReturnValue(of({ orgUid: listOrgUid, claGroups }));

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [OrgEasyclaComponent],
        providers: [
          provideRouter([]),
          provideNoopAnimations(),
          {
            provide: AccountContextService,
            useValue: { selectedAccount, hasOrgSelectorAccess, availableAccounts: signal([SELECTED_ACCOUNT]), setAccount: vi.fn() },
          },
          { provide: OrgRoleGrantsService, useValue: { loaded: grantsLoaded } },
          { provide: PersonaService, useValue: { personaLoaded } },
          { provide: OrgNavigationService, useValue: { loaded: navLoaded, resetAndReload: vi.fn() } },
          { provide: OrgLensClaService, useValue: { getClaGroups } },
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(org ? { org } : {}) } } },
          MessageService,
        ],
      })
        .overrideComponent(OrgEasyclaComponent, { set: { providers: [{ provide: DialogService, useValue: { open: openDialog } }] } })
        .compileComponents();

      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      const fixture = TestBed.createComponent(OrgEasyclaComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();

      return { fixture, navigate };
    }

    beforeEach(() => sessionStorage.clear());

    // Replaces rather than pushes: the address left behind is the return address, and an entry for
    // it is one Back re-enters — spending nothing and stripping a parameter all over again.
    it('lands on the agreement just signed, without leaving the return address in history', async () => {
      const { navigate } = await renderAfterSigning();

      expect(navigate).toHaveBeenCalledWith(SIGNED, { replaceUrl: true });
    });

    /**
     * EasyCLA may not have finished processing the DocuSign callback by the time the signatory is
     * back. Navigating blind would land them on "This CLA was not found", which is strictly worse
     * than the list — so the first answer without the row is treated as too early, not as no.
     */
    it('asks again rather than giving up when the signed agreement is not in the list yet', async () => {
      vi.useFakeTimers();
      try {
        getClaGroups.mockReturnValueOnce(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [] }));
        const { fixture, navigate } = await renderAfterSigning({ claGroups: [] });
        expect(navigate).not.toHaveBeenCalledWith(SIGNED, expect.anything());

        // The callback lands between the first answer and the retry.
        getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup()] }));
        await vi.advanceTimersByTimeAsync(2000);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(navigate).toHaveBeenCalledWith(SIGNED, { replaceUrl: true });
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * A failed request answers nothing about the row, but it does answer whether to keep waiting.
     * The page fetches once per organization, so nothing arrives to replace the failure — and a
     * wait on the list it did not return never ends. Left there, a transient outage strands the
     * signatory on an error page with the organization still on the address and the stash already
     * spent, so not even a reload recovers the landing.
     */
    it('asks again rather than waiting for ever when the list request fails', async () => {
      vi.useFakeTimers();
      try {
        getClaGroups.mockReturnValueOnce(throwError(() => new Error('upstream')));

        const { fixture, navigate } = await renderAfterSigning();
        expect(navigate).not.toHaveBeenCalledWith(SIGNED, expect.anything());

        await vi.advanceTimersByTimeAsync(2000);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(navigate).toHaveBeenCalledWith(SIGNED, { replaceUrl: true });
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * Bounded, because past a few seconds the likelier explanations are ones no amount of waiting
     * fixes — and a page that keeps asking for ever is worse than one that leaves them on the list.
     *
     * Clearing the address is this flow's job by then. The sibling adoption stands down as soon as
     * a landing is intended, so nothing else will do it, and the organization surviving the visit
     * is the one thing it must not do.
     */
    it('gives up on a budget, leaving the signatory on the list with a clean address', async () => {
      vi.useFakeTimers();
      try {
        const { fixture, navigate } = await renderAfterSigning({ claGroups: [] });

        await vi.advanceTimersByTimeAsync(30_000);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(navigate).not.toHaveBeenCalledWith(SIGNED, expect.anything());
        expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { org: null } }));
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * Whichever organization was selected at boot settles first and cannot contain the new
     * agreement, so a decision taken against that list would spend the trip on a row that was never
     * going to be in it.
     */
    it('waits for the named organization’s own list rather than deciding on the one in hand', async () => {
      const { navigate } = await renderAfterSigning({ listOrgUid: '0014100000Te2QjAAJ' });

      expect(navigate).not.toHaveBeenCalledWith(SIGNED, expect.anything());
    });

    // Otherwise an abandoned ceremony leaves a signature behind that hijacks an ordinary visit to
    // the list, days later, on whatever return trip finds it.
    it('does not divert an ordinary visit, and spends the signature anyway', async () => {
      const { navigate } = await renderAfterSigning({ org: null });

      expect(navigate).not.toHaveBeenCalledWith(SIGNED, expect.anything());
      // Spent either way, which is what makes it single-use whichever visit finds it.
      expect(sessionStorage.getItem(ORG_CLA_SIGNED_SIGNATURE_KEY)).toBeNull();
    });

    it('stays on the list when no ceremony left a signature behind', async () => {
      const { navigate } = await renderAfterSigning({ stash: '' });

      expect(navigate).not.toHaveBeenCalledWith(SIGNED, expect.anything());
    });

    /**
     * Both return flows navigate, and Angular cancels an in-flight navigation when another begins,
     * so the address has to be arbitrated rather than stripped by both. Landing wins; the parameter
     * leaves with the route it sat on.
     *
     * Asserted as the ONLY navigation, because the defect this pins was not a wrong destination. It
     * was a second, entirely correct-looking strip back to the list, which cancelled the landing and
     * left the signatory exactly where they would have been with no feature at all. Asserting only
     * that the landing was requested passes against it — the request was always made.
     */
    it('does not strip the address back to the list while landing on the agreement', async () => {
      const { navigate } = await renderAfterSigning();

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(SIGNED, { replaceUrl: true });
    });

    // No list is ever fetched for an organization the viewer does not hold, so waiting on one would
    // wait for ever and strand the organization on the address.
    it('gives up, and still clears the address, when the named organization is not the viewer’s', async () => {
      const { navigate } = await renderAfterSigning({ org: 'not-an-organization-they-hold' });

      expect(navigate).not.toHaveBeenCalledWith(SIGNED, expect.anything());
      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { org: null } }));
    });
  });
});
