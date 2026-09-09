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
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
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
        { provide: OrgNavigationService, useValue: { loaded: navLoaded } },
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
  describe('corporate signing flow', () => {
    const chosen = { claGroupId: 'cla-group-uuid-1', projectSfid: 'a09410000182dD2AAI', projectName: 'Cascade' };

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
        return { onClose: of(result), close: vi.fn() };
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
          { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess } },
          { provide: OrgRoleGrantsService, useValue: { loaded: grantsLoaded } },
          { provide: PersonaService, useValue: { personaLoaded } },
          { provide: OrgNavigationService, useValue: { loaded: navLoaded } },
          { provide: OrgLensClaService, useValue: { getClaGroups } },
          MessageService,
        ],
      })
        // The component provides DialogService itself, so the component-level provider is the one
        // that has to be replaced; a module-level override would not be seen.
        .overrideComponent(OrgEasyclaComponent, { set: { providers: [{ provide: DialogService, useValue: { open: harness.open } }] } })
        .compileComponents();

      const fixture = TestBed.createComponent(OrgEasyclaComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return { fixture, harness };
    }

    it('asks which CLA group to sign for, scoped to the selected organization', async () => {
      const { fixture, harness } = await renderWithDialogs([null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened).toHaveLength(1);
      expect(harness.opened[0].config.data).toEqual({ orgUid: SELECTED_ACCOUNT.uid });
    });

    it('does not ask for a confirmation when no CLA group was chosen', async () => {
      const { fixture, harness } = await renderWithDialogs([null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened).toHaveLength(1);
    });

    it('does not hand off when the confirmation step was dismissed', async () => {
      const { fixture, harness } = await renderWithDialogs([chosen, null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened).toHaveLength(2);
    });

    // The load-bearing one. Whatever the attestation dialog closed with is what the hand-off is
    // given — not a `true` written here, and not an inference from the dialog having closed at
    // all. A regression that hardcoded these would make the signatory's confirmation unfalsifiable
    // from this side.
    it('hands the confirmations to the signing step exactly as the signatory gave them', async () => {
      const attestations = { authorityAcked: true, embargoAcked: true };
      const { fixture, harness } = await renderWithDialogs([chosen, attestations, null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened).toHaveLength(3);
      expect(harness.opened[2].config.data).toEqual({
        orgUid: SELECTED_ACCOUNT.uid,
        projectSfid: chosen.projectSfid,
        claGroupId: chosen.claGroupId,
        attestations,
      });
    });

    /**
     * The hand-off opens locked by all three routes, and the component reopens them once the
     * request has landed.
     *
     * The initial values belong here rather than in the hand-off's own suite, which supplies its
     * own config and so cannot see what this call site passes. The signing request starts as that
     * dialog appears and is the call that creates both the signature record and the DocuSign
     * envelope: dismissed before the address comes back, it leaves an envelope nobody was handed.
     */
    it('opens the hand-off with no way to dismiss it', async () => {
      const attestations = { authorityAcked: true, embargoAcked: true };
      const { fixture, harness } = await renderWithDialogs([chosen, attestations, null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened[2].config).toMatchObject({ closable: false, closeOnEscape: false, dismissableMask: false });
    });

    // The two steps before it are freely dismissable: nothing has been created yet, and trapping
    // someone in a legal confirmation they want to back out of would be its own problem.
    it.each([
      [0, 'CLA group picker'],
      [1, 'attestation step'],
    ])('leaves the %s dismissable, because nothing exists yet to lose', async (index) => {
      const { fixture, harness } = await renderWithDialogs([chosen, { authorityAcked: true, embargoAcked: true }, null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();

      expect(harness.opened[index].config.closable).toBe(true);
    });

    // A dismissed flow must release the control, or the page needs a reload to try again.
    it('offers the control again after a dismissed flow', async () => {
      const { fixture } = await renderWithDialogs([null]);

      byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();
      fixture.detectChanges();

      expect(byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.disabled).toBe(false);
    });

    /**
     * Switching organizations with a signing flow part-way open.
     *
     * These need dialogs that stay open, so they use a harness whose `onClose` is a Subject the
     * test controls. The one above emits synchronously, which closes every dialog the instant it
     * opens — fine for asserting what gets passed along, useless for asserting what happens while
     * one is still standing.
     */
    describe('when the organization changes part-way through', () => {
      interface OpenDialog {
        component: unknown;
        config: DialogHarnessConfig;
        close: ReturnType<typeof vi.fn>;
        /** Emit to drive this dialog's own close, which is how the flow advances a step. */
        onClose: Subject<unknown>;
      }

      function openDialogHarness() {
        const opened: OpenDialog[] = [];
        const open = vi.fn((component: unknown, config: DialogHarnessConfig = {}) => {
          const dialog: OpenDialog = { component, config, close: vi.fn(), onClose: new Subject<unknown>() };
          opened.push(dialog);
          return { onClose: dialog.onClose, close: dialog.close };
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
            { provide: OrgNavigationService, useValue: { loaded: navLoaded } },
            { provide: OrgLensClaService, useValue: { getClaGroups } },
            MessageService,
          ],
        })
          .overrideComponent(OrgEasyclaComponent, { set: { providers: [{ provide: DialogService, useValue: { open: harness.open } }] } })
          .compileComponents();

        const fixture = TestBed.createComponent(OrgEasyclaComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return { fixture, harness };
      }

      /**
       * The load-bearing one, and the reason the close exists at all.
       *
       * `orgUid` is read once when the flow starts and carried through all three dialogs, and
       * switching organizations does not destroy this component. So a picker left standing lists
       * the previous organization's CLA groups, and choosing one would open a signing session
       * against a company the viewer is no longer looking at — the detail page's stale-download
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

      // Nothing has been created at this point either, and the confirmations are about a specific
      // organization's authority and export position — they cannot carry over to another company.
      it('closes the attestation step as well, since no signature has been asked for yet', async () => {
        const { fixture, harness } = await renderWithOpenDialogs();

        byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();
        // Choosing a CLA group closes the picker and opens the attestation dialog behind it.
        harness.opened[0].onClose.next(chosen);
        expect(harness.opened).toHaveLength(2);

        selectedAccount.set({ uid: '0014100000Te2QjAAJ', accountName: 'Meridian Systems' });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(harness.opened[1].close).toHaveBeenCalled();
      });

      /**
       * The hand-off is deliberately not closed.
       *
       * By the time it is open the request has been issued and a signature record and DocuSign
       * envelope exist for the organization that was selected when the viewer confirmed — which
       * is the one they meant to sign for. The address that comes back is the only thing that
       * reaches them, so closing this on a switch would orphan an envelope to save nothing. It is
       * also why the field holding the closeable ref is named for the uncommitted half.
       */
      it('leaves the hand-off standing, because a signing session already exists behind it', async () => {
        const { fixture, harness } = await renderWithOpenDialogs();

        byTestId(fixture, 'org-easycla-sign-cla')?.querySelector('button')?.click();
        harness.opened[0].onClose.next(chosen);
        harness.opened[1].onClose.next({ authorityAcked: true, embargoAcked: true });
        expect(harness.opened).toHaveLength(3);

        selectedAccount.set({ uid: '0014100000Te2QjAAJ', accountName: 'Meridian Systems' });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(harness.opened[2].close).not.toHaveBeenCalled();
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
});
