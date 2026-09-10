// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, Navigation, provideRouter, Router } from '@angular/router';
import { CCLA_SIGN_COPY, ORG_CLA_LOCKED_TAB_COPY, ORG_CLA_NOT_STARTED_COPY, ORG_CLA_SIGN_SELECTION_STATE } from '@lfx-one/shared/constants';
import type { OrgClaGroup, OrgClaSignSelection } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { OrgNavigationService } from '@shared/services/org-navigation.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { OrgEasyclaCoverageDialogComponent } from '../org-easycla-coverage-dialog/org-easycla-coverage-dialog.component';
import { OrgEasyclaAttestationComponent } from '../org-easycla-sign/org-easycla-attestation.component';
import { OrgEasyclaSignHandoffComponent } from '../org-easycla-sign/org-easycla-sign-handoff.component';
import { OrgEasyclaDetailComponent } from './org-easycla-detail.component';

describe('OrgEasyclaDetailComponent', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000AcmeOrgAAA', accountName: 'Acme' };

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(null);
  const hasOrgSelectorAccess = signal(true);
  const grantsLoaded = signal(true);
  const personaLoaded = signal(true);
  const navLoaded = signal(true);
  const paramMap = new BehaviorSubject(convertToParamMap({ signatureId: 'signature-uuid-1' }));

  const getClaGroups = vi.fn();
  const getPdfUrl = vi.fn();
  const addMessage = vi.fn();
  const openDialog = vi.fn();

  /** Where the page tried to go. Installed by `render` on the real router; see the spy there. */
  let navigate: MockInstance<Router['navigate']>;

  function claGroup(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupName: 'Nimbus Foundation CLA',
      claGroupId: 'cla-group-uuid-1',
      foundationName: 'Nimbus Foundation',
      projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
      signedOn: '2024-03-11',
      signed: true,
      status: 'signed',
      needsClaManager: false,
      claManagersCount: 2,
      approvalCriteriaCount: 7,
      ...overrides,
    };
  }

  /**
   * Renders the page, optionally as the preview the picker navigates to.
   *
   * The selection is installed on the navigation rather than passed to the component, because
   * reading it back out of the navigation is the part under test: the address holds nothing, so a
   * selection handed in directly would pass on a page that renders blank in the browser.
   */
  async function render(previewState?: Record<string, unknown>, restoredState?: Record<string, unknown>): Promise<ComponentFixture<OrgEasyclaDetailComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: { paramMap, snapshot: { paramMap: paramMap.value } } },
        { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess } },
        { provide: OrgRoleGrantsService, useValue: { loaded: grantsLoaded } },
        { provide: PersonaService, useValue: { personaLoaded } },
        { provide: OrgNavigationService, useValue: { loaded: navLoaded } },
        { provide: OrgLensClaService, useValue: { getClaGroups, getPdfUrl } },
        { provide: MessageService, useValue: { add: addMessage } },
      ],
    }).compileComponents();

    TestBed.overrideComponent(OrgEasyclaDetailComponent, {
      set: { providers: [{ provide: DialogService, useValue: { open: openDialog } }] },
    });

    const router = TestBed.inject(Router);
    // The test module declares no routes, so a real navigation would resolve to nothing and the
    // assertion would be about the router's failure rather than about where the page tried to go.
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    // Read in a field initializer, so the answer has to be in place before the component exists.
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue(
      previewState === undefined ? null : ({ extras: { state: previewState } } as unknown as Navigation)
    );
    // The history entry, which outlives the navigation that wrote it. Empty by default, as it is on
    // an address nobody arrived at through the picker.
    vi.spyOn(TestBed.inject(Location), 'getState').mockReturnValue(restoredState ?? {});

    const fixture = TestBed.createComponent(OrgEasyclaDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function byTestId(fixture: ComponentFixture<OrgEasyclaDetailComponent>, id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  beforeEach(() => {
    selectedAccount.set(SELECTED_ACCOUNT);
    hasOrgSelectorAccess.set(true);
    grantsLoaded.set(true);
    personaLoaded.set(true);
    navLoaded.set(true);
    paramMap.next(convertToParamMap({ signatureId: 'signature-uuid-1' }));
    getClaGroups.mockReset();
    getPdfUrl.mockReset();
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup()] }));
    getPdfUrl.mockReturnValue(of({ url: 'https://s3.example.org/ccla.pdf', expiresInSeconds: 0 }));
    addMessage.mockReset();
    openDialog.mockReset();
  });

  it('names the CLA Group and shows the list row status', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Nimbus Foundation CLA');
    expect(byTestId(fixture, 'org-easycla-detail-status')?.textContent).toContain('Signed');
  });

  it('states the signed date alone when the row names no signer', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-signed-on')?.textContent?.trim()).toBe('Signed on Mar 11, 2024.');
    expect(byTestId(fixture, 'org-easycla-detail-signed-on')?.textContent).not.toContain('Signed by');
  });

  // Signed-ness is stated as a token everywhere else on this page — the status pill takes its
  // severity from ORG_CLA_STATUS_DISPLAY — so the affirmation must not restate it in hex. This
  // asserts the theme owns the colour, which is what an earlier hand-rolled tinted box did not:
  // it reached for a Tailwind default scale the theme never defines, and nothing failed.
  it('leaves the success colour to the theme rather than tinting the line itself', async () => {
    const fixture = await render();
    const line = byTestId(fixture, 'org-easycla-detail-signed-on');

    expect(line?.querySelector('p-message')).not.toBeNull();
    expect(line?.className ?? '').not.toMatch(/(bg|text|border)-(green|emerald)-/);
    expect(line?.querySelector('[class*="-green-"], [class*="-emerald-"]')).toBeNull();
  });

  it('names the signer and the time of day when the row carries both', async () => {
    getClaGroups.mockReturnValue(
      of({
        orgUid: SELECTED_ACCOUNT.uid,
        claGroups: [claGroup({ signedOn: '2024-03-11T09:20:00Z', signedBy: 'Alex Signer' })],
      })
    );

    const fixture = await render();
    const line = byTestId(fixture, 'org-easycla-detail-signed-on')?.textContent?.replace(/\s+/g, ' ').trim();

    // The zone is the viewer's, so the clock reading is asserted by shape rather than by value.
    expect(line).toMatch(/^Signed by Alex Signer on Mar 1[12], 2024, \d{1,2}:\d{2}:\d{2} (AM|PM)\.$/);
  });

  it('falls back to the date alone when the signature carries no signatory name', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ signedOn: '2024-03-11T09:20:00Z' })] }));

    const fixture = await render();
    const line = byTestId(fixture, 'org-easycla-detail-signed-on')?.textContent?.replace(/\s+/g, ' ').trim();

    expect(line).toMatch(/^Signed on Mar 1[12], 2024, \d{1,2}:\d{2}:\d{2} (AM|PM)\.$/);
  });

  it('omits the signed line when the row has no signed date', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ signedOn: undefined })] }));

    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-signed-on')).toBeNull();
  });

  it.each([
    ['signed', 'Nimbus Foundation CLA — Signed'],
    ['not-started', 'Nimbus Foundation CLA — Not yet signed'],
    ['sanctioned', 'Nimbus Foundation CLA — Unavailable'],
  ] as const)('heads the Overview card with the %s state of the agreement', async (status, heading) => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ status })] }));

    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-ccla-title')?.textContent?.trim()).toBe(heading);
  });

  it('says who the agreement covers, naming the organization', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-ccla-hint')?.textContent?.trim()).toBe("Covers 2 projects for Acme's employees.");
  });

  it('names the single covered project rather than counting it', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ projects: [{ projectName: 'Cascade' }] })] }));

    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-ccla-hint')?.textContent?.trim()).toBe("Covers Cascade for Acme's employees.");
  });

  describe('an agreement the organization has not signed', () => {
    const notStarted = { status: 'not-started' as const, signed: false, signedOn: undefined };

    it('explains the process instead of leaving the tab empty', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();

      const panel = byTestId(fixture, 'org-easycla-detail-not-started');
      expect(panel).not.toBeNull();
      // All three steps, not merely the heading: the steps are where the consequence of signing —
      // that the signer becomes the initial CLA Manager — is stated before it happens.
      expect(panel?.querySelectorAll('li').length).toBe(3);
      expect(panel?.textContent).toContain(ORG_CLA_NOT_STARTED_COPY.stepsHeading);
      for (const step of ORG_CLA_NOT_STARTED_COPY.steps) {
        expect(panel?.textContent).toContain(step.body);
      }
    });

    it('names the organization and the agreement it has not signed', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ ...notStarted, claGroupName: 'Cascade CLA' })] }));

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-detail-not-started-lead')?.textContent?.trim()).toBe('Acme has not yet signed a CLA for Cascade CLA.');
    });

    it('numbers the steps as a list, so their order and count are announced', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-detail-not-started')?.querySelector('ol')).not.toBeNull();
    });

    it('does not start signing when the agreement has no project to sign against', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();

      // Same reason the picker leaves a row visible but unselectable: the producer signs by
      // project, and a row with no project SFID cannot be bound to a request.
      const start = byTestId(fixture, 'org-easycla-detail-start-cla');
      expect(start).not.toBeNull();
      expect(start?.querySelector('button')?.disabled).toBe(true);
      expect(start?.querySelector('button')?.getAttribute('aria-label')).toContain(CCLA_SIGN_COPY.picker.multiProjectDisabledReason);
    });

    it('starts the confirmation for this agreement, without asking which CLA group', async () => {
      openDialog.mockReturnValue({ onClose: of(null), onDestroy: of(undefined), close: vi.fn() });
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      const start = byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button');
      expect(start?.disabled).toBe(false);

      start?.click();

      expect(openDialog).toHaveBeenCalledTimes(1);
      expect(openDialog.mock.calls[0][0]).toBe(OrgEasyclaAttestationComponent);
    });

    it('offers Start again after the header close tears the dialog down without onClose', async () => {
      const onClose = new Subject<unknown>();
      const onDestroy = new Subject<void>();
      openDialog.mockReturnValue({ onClose, onDestroy, close: vi.fn() });
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      const start = (): HTMLButtonElement | null | undefined => byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button');
      start()?.click();
      fixture.detectChanges();
      expect(start()?.disabled).toBe(true);

      onDestroy.next();
      fixture.detectChanges();

      expect(start()?.disabled).toBe(false);
    });

    // The attestation panel closes on `onClose`, and the hand-off is opened on the ref's later
    // `onDestroy` — the wait keeps a second dialog from stacking on top of the first while its
    // leave animation is still running. That wait is also a window in which the organization or
    // the CLA Group underneath the page can change: the attestation itself names neither, so the
    // captured values from the click that opened it are no longer the ones the viewer confirms.
    // These two tests pin the sync re-check inside the `onDestroy` callback that refuses to open
    // the hand-off when either has moved.
    it('refuses to open the hand-off when the organization changed during the attestation teardown', async () => {
      const attestations = { authorityAcked: true, embargoAcked: true };
      const attestationOnClose = new Subject<unknown>();
      const attestationOnDestroy = new Subject<void>();
      const opened: unknown[] = [];
      openDialog.mockImplementation((component: unknown) => {
        opened.push(component);
        return { onClose: attestationOnClose, onDestroy: attestationOnDestroy, close: vi.fn() };
      });

      const signable = {
        ...notStarted,
        claGroupId: 'cla-group-uuid-1',
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.click();
      fixture.detectChanges();

      attestationOnClose.next(attestations);
      // Between onClose and onDestroy, the viewer switches organizations. The click captured the
      // Acme uid; opening the hand-off now would sign Acme's CCLA for a different company.
      selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
      attestationOnDestroy.next();
      fixture.detectChanges();

      // The invariant is a negative: only the attestation was opened. Without the sync re-check
      // in `openHandOffIfContextHeld`, the callback would run against the captured Acme uid and
      // stack a `OrgEasyclaSignHandoffComponent` on the page under Other.
      expect(opened).toEqual([OrgEasyclaAttestationComponent]);
    });

    it('refuses to open the hand-off when the CLA Group under the page changed during the attestation teardown', async () => {
      const attestations = { authorityAcked: true, embargoAcked: true };
      const attestationOnClose = new Subject<unknown>();
      const attestationOnDestroy = new Subject<void>();
      const opened: unknown[] = [];
      openDialog.mockImplementation((component: unknown) => {
        opened.push(component);
        return { onClose: attestationOnClose, onDestroy: attestationOnDestroy, close: vi.fn() };
      });

      const initial = { ...notStarted, claGroupId: 'cla-group-uuid-1', projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }] };
      const swapped = { ...notStarted, claGroupId: 'cla-group-uuid-2', projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }] };
      const groups = new BehaviorSubject({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(initial)] });
      getClaGroups.mockReturnValue(groups);

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.click();
      fixture.detectChanges();

      attestationOnClose.next(attestations);
      // Between onClose and onDestroy, a fresh list arrives whose row for this signature id names
      // a different CLA Group. Opening the hand-off with the captured claGroupId would sign the
      // agreement the viewer is no longer looking at.
      groups.next({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(swapped)] });
      attestationOnDestroy.next();
      fixture.detectChanges();

      expect(opened).toEqual([OrgEasyclaAttestationComponent]);
      expect(byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.disabled).toBe(false);
    });

    it('hands the confirmations to the signing step for this agreement', async () => {
      const attestations = { authorityAcked: true, embargoAcked: true };
      const opened: { component: unknown; config: { data?: unknown; closable?: boolean } }[] = [];
      openDialog.mockImplementation((component: unknown, config: { data?: unknown; closable?: boolean } = {}) => {
        opened.push({ component, config });
        const result = opened.length === 1 ? attestations : null;
        return { onClose: of(result), onDestroy: of(undefined), close: vi.fn() };
      });

      const signable = {
        ...notStarted,
        claGroupId: 'cla-group-uuid-1',
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.click();

      expect(opened).toHaveLength(2);
      expect(opened[1].component).toBe(OrgEasyclaSignHandoffComponent);
      expect(opened[1].config.data).toEqual({
        orgUid: SELECTED_ACCOUNT.uid,
        projectSfid: 'a09410000182dD2AAI',
        claGroupId: 'cla-group-uuid-1',
        attestations,
      });
    });

    it('signs a foundation-level agreement against the foundation, not one project it covers', async () => {
      const opened: { config: { data?: unknown } }[] = [];
      openDialog.mockImplementation((_component: unknown, config: { data?: unknown } = {}) => {
        opened.push({ config });
        return { onClose: of(opened.length === 1 ? { authorityAcked: true, embargoAcked: true } : null), onDestroy: of(undefined), close: vi.fn() };
      });

      // The ordinary shape of an unsigned agreement: one CLA Group covering several projects
      // under a foundation, each project carrying its own SFID.
      const foundationLevel = {
        ...notStarted,
        claGroupId: 'cla-group-uuid-1',
        foundationSfid: 'a09410000182dFOUND',
        projects: [
          { projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' },
          { projectName: 'Driftwood', projectSfid: 'a09410000182dD3AAI' },
        ],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(foundationLevel)] }));

      const fixture = await render();
      expect(byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.disabled).toBe(false);
      byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.click();

      // The first covered project's SFID would bind the agreement to that project alone, and
      // nothing downstream would notice: it resolves back to this same CLA Group, so the
      // response's group-mismatch check sees the id it asked for.
      expect(opened[1].config.data).toMatchObject({ projectSfid: 'a09410000182dFOUND', claGroupId: 'cla-group-uuid-1' });
    });

    it('refuses to choose between several covered projects when there is no foundation', async () => {
      const ambiguous = {
        ...notStarted,
        projects: [
          { projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' },
          { projectName: 'Driftwood', projectSfid: 'a09410000182dD3AAI' },
        ],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(ambiguous)] }));

      const fixture = await render();

      // Both projects carry an SFID, so a choice is available — and that is the reason to refuse
      // it. Search declines to name a project for this shape and the picker greys the row out.
      expect(byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.disabled).toBe(true);
    });

    it('does not explain the process on a signed agreement', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup()] }));

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-detail-not-started')).toBeNull();
    });

    it('does not walk a sanctioned agreement through how to start signing', async () => {
      // Sanctions take the same status slot, and that viewer's obstacle is not a missing signature
      // — telling them how to begin would talk past the reason they cannot.
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ status: 'sanctioned', signed: false, signedOn: undefined })] }));

      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-detail-not-started')).toBeNull();
    });
  });

  /**
   * The preview a signatory reads before starting a corporate CLA (#1983), reached from the picker.
   *
   * Nothing on this route is fetched. There is no fetch-a-CLA-group-by-id endpoint upstream, so the
   * page is built entirely from the choice the navigation carried — which is why these cases pass no
   * `signatureId` and assert that no list is requested.
   */
  describe('previewing a CLA Group the picker chose', () => {
    const CASCADE: OrgClaSignSelection = {
      claGroupId: 'cla-group-uuid-1',
      claGroupName: 'Cascade CLA',
      projectSfid: 'a09410000182dD2AAI',
      projectName: 'Cascade',
      orgUid: SELECTED_ACCOUNT.uid,
    };

    function previewing(selection: Partial<OrgClaSignSelection> = {}): Record<string, unknown> {
      return { [ORG_CLA_SIGN_SELECTION_STATE]: { ...CASCADE, ...selection } };
    }

    beforeEach(() => {
      paramMap.next(convertToParamMap({}));
    });

    it('heads the page with the CLA Group the picker chose', async () => {
      const fixture = await render(previewing());

      expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Cascade CLA');
      expect(byTestId(fixture, 'org-easycla-detail-status')?.textContent).toContain('Not started');
    });

    /**
     * A reload, and any restore, arrives with no navigation in flight to carry the choice — but the
     * history entry the picker wrote is still there. Reading only the navigation would answer a
     * refresh by discarding the selection and sending the signatory back to the picker to make it
     * again.
     */
    it('keeps the choice when the page is reloaded onto it', async () => {
      const fixture = await render(undefined, previewing());

      expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Cascade CLA');
      expect(navigate).not.toHaveBeenCalled();
    });

    // The row-shaped states of a page that fetches a list. Neither can be reached without a list in
    // hand, and `notFound` firing here would tell a signatory the agreement they are about to sign
    // does not exist.
    it('asks for no list, and shows neither a skeleton nor a missing agreement', async () => {
      const fixture = await render(previewing());

      expect(getClaGroups).not.toHaveBeenCalled();
      expect(byTestId(fixture, 'org-easycla-detail-list-loading')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-not-found-state')).toBeNull();
    });

    /**
     * Start must reach the hand-off from the preview, and against the project the picker resolved.
     *
     * This is what the synthesized row is shaped for: one covered project and no foundation SFID, so
     * `signingChoice` resolves to the picker's own SFID rather than inventing a foundation-level
     * agreement out of a choice that was made at project level.
     */
    it('starts the confirmation against the project the picker resolved', async () => {
      const opened: { component: unknown; config: { data?: unknown } }[] = [];
      openDialog.mockImplementation((component: unknown, config: { data?: unknown } = {}) => {
        opened.push({ component, config });
        return { onClose: of(opened.length === 1 ? { authorityAcked: true, embargoAcked: true } : null), onDestroy: of(undefined), close: vi.fn() };
      });

      const fixture = await render(previewing());
      const start = byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button');
      expect(start?.disabled).toBe(false);

      start?.click();

      expect(opened[0].component).toBe(OrgEasyclaAttestationComponent);
      expect(opened[1].config.data).toMatchObject({ claGroupId: CASCADE.claGroupId, projectSfid: CASCADE.projectSfid });
    });

    // A pasted, bookmarked or linked preview address arrives with nothing, and nothing here can
    // rebuild it. The list is where the picker lives, so it is a redirect rather than an empty state.
    it('leaves for the list when the address carries no selection', async () => {
      await render();

      expect(navigate).toHaveBeenCalledWith(['/org/easycla'], { replaceUrl: true });
    });

    /**
     * A truncated selection is treated as no selection at all.
     *
     * The value comes back out of a history entry, so it can have been written by an earlier
     * deployment. Trusted, a partial one heads the page with an undefined name and still offers
     * Start — a missing project SFID only disables signing once something reads it.
     */
    it.each([['claGroupId'], ['claGroupName'], ['projectSfid'], ['projectName'], ['orgUid']] as const)(
      'leaves for the list when %s is missing',
      async (field) => {
        await render(previewing({ [field]: '' }));

        expect(navigate).toHaveBeenCalledWith(['/org/easycla'], { replaceUrl: true });
      }
    );

    /**
     * An organization switch invalidates the preview, not merely an open dialog.
     *
     * The choice was made under the organization the viewer has just left, and Start would open a
     * session against the one they arrived at. Nothing here can be re-derived for it either — the CLA
     * Group named may not be one the new organization can sign.
     */
    it('leaves for the list when the viewer switches organization', async () => {
      const fixture = await render(previewing());
      expect(navigate).not.toHaveBeenCalled();

      selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(navigate).toHaveBeenCalledWith(['/org/easycla'], { replaceUrl: true });
    });

    /**
     * The same mismatch arriving without a switch to witness.
     *
     * The choice lives in a history entry and the selected organization is a cookie another tab can
     * change, so back or reload can render this page with the wrong company already in force. It is
     * the *initial* value then, not a change — so the choice has to carry the organization it was
     * made under for there to be anything to compare.
     */
    it('leaves for the list when the choice was made under another organization', async () => {
      await render(previewing({ orgUid: '0014100000OtherOrgAA' }));

      expect(navigate).toHaveBeenCalledWith(['/org/easycla'], { replaceUrl: true });
    });

    /**
     * The redirect that leaves the page is asynchronous, so the first render can present a Start
     * button that is enabled and clickable against a selected organization the choice was not made
     * for. Without the guard, a race click during that window would open the hand-off — for the
     * wrong company. The disabled state at first render is what closes it.
     */
    it('disables Start when the preview organization does not match the selected one', async () => {
      const fixture = await render(previewing({ orgUid: '0014100000OtherOrgAA' }));

      const start = byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button');
      expect(start?.disabled).toBe(true);
    });

    /**
     * The action boundary is asserted separately from the disabled state, because a race click can
     * arrive between the enabled paint and the async redirect. Refusing at `startClaProcess` is the
     * belt to the disabled state's braces.
     */
    it('refuses the click even if the button somehow fires under a mismatched selection', async () => {
      const opened: { component: unknown }[] = [];
      openDialog.mockImplementation((component: unknown) => {
        opened.push({ component });
        return { onClose: of(null), onDestroy: of(undefined), close: vi.fn() };
      });

      const fixture = await render(previewing());
      // The component is on-screen against SELECTED_ACCOUNT. Simulate the race window by switching
      // the account after the guard has read a matching value, then calling the action directly.
      selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
      const component = fixture.componentInstance as unknown as { startClaProcess: () => void };
      component.startClaProcess();

      expect(opened).toEqual([]);
    });
  });

  /**
   * Angular reuses this component across `/org/easycla/new` and `/org/easycla/:signatureId`. When
   * a signatory navigates from the preview onto the newly-signed agreement, the previous route's
   * `history.state` is still what `Location.getState()` returns until Angular has written the new
   * entry \u2014 so the constructor of the reused component instance can read a picker choice that
   * has nothing to do with the URL it is being reused under.
   *
   * If that leftover state drives `previewing`, the page skips the list fetch, latches the stale
   * selection, and renders the unsigned preview instead of the signed agreement in the URL. The
   * agreement route is disqualified from the history fallback by the presence of `signatureId`
   * in the route's parameter map, whether or not `extras.state` was carried by the navigation.
   */
  describe('a stale history entry from a previous /new visit', () => {
    const CASCADE: OrgClaSignSelection = {
      claGroupId: 'cla-group-uuid-1',
      claGroupName: 'Cascade CLA',
      projectSfid: 'a09410000182dD2AAI',
      projectName: 'Cascade',
      orgUid: SELECTED_ACCOUNT.uid,
    };

    it('does not drive the preview when the route is an agreement id', async () => {
      // The paramMap default (`signatureId: 'signature-uuid-1'`) is the agreement route.
      const fixture = await render(undefined, { [ORG_CLA_SIGN_SELECTION_STATE]: CASCADE });

      // The list is what the agreement page reads, so the fetch is what pins that the guard held.
      expect(getClaGroups).toHaveBeenCalled();
      // And the preview page's own signal is off, so no side of it can render.
      const component = fixture.componentInstance as unknown as { previewing: boolean };
      expect(component.previewing).toBe(false);
    });
  });

  /**
   * The two dialogs this page owns, driven with a harness whose closes the test controls.
   *
   * The shared `openDialog` stub closes synchronously, which is fine for asserting what gets passed
   * along and useless for asserting what happens while one is still standing.
   */
  describe('the signing dialogs this page owns', () => {
    interface OpenDialog {
      component: unknown;
      config: { data?: unknown; closable?: boolean; closeOnEscape?: boolean; dismissableMask?: boolean };
      close: ReturnType<typeof vi.fn>;
      /** Emit to drive this dialog's own close, which is how the flow advances a step. */
      onClose: Subject<unknown>;
      /** Emit after `onClose` to finish the leave animation. The next step waits on this. */
      onDestroy: Subject<void>;
    }

    const opened: OpenDialog[] = [];
    const attestations = { authorityAcked: true, embargoAcked: true };

    beforeEach(() => {
      opened.length = 0;
      openDialog.mockImplementation((component: unknown, config: OpenDialog['config'] = {}) => {
        const dialog: OpenDialog = { component, config, close: vi.fn(), onClose: new Subject<unknown>(), onDestroy: new Subject<void>() };
        opened.push(dialog);
        return { onClose: dialog.onClose, onDestroy: dialog.onDestroy, close: dialog.close };
      });
      getClaGroups.mockReturnValue(
        of({
          orgUid: SELECTED_ACCOUNT.uid,
          claGroups: [
            claGroup({
              status: 'not-started',
              signed: false,
              signedOn: undefined,
              projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
            }),
          ],
        })
      );
    });

    async function start(): Promise<ComponentFixture<OrgEasyclaDetailComponent>> {
      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.click();
      return fixture;
    }

    /**
     * The hand-off opens locked by all three routes.
     *
     * The initial values belong here rather than in the hand-off's own suite, which supplies its own
     * config and so cannot see what this call site passes. The signing request starts as that dialog
     * appears and is the call that creates both the signature record and the DocuSign envelope:
     * dismissed before the address comes back, it leaves an envelope nobody was handed.
     */
    it('opens the hand-off with no way to dismiss it', async () => {
      await start();
      opened[0].onClose.next(attestations);
      opened[0].onDestroy.next();

      expect(opened[1].component).toBe(OrgEasyclaSignHandoffComponent);
      expect(opened[1].config).toMatchObject({ closable: false, closeOnEscape: false, dismissableMask: false });
    });

    // The step before it is freely dismissable: nothing has been created yet, and trapping someone
    // in a legal confirmation they want to back out of would be its own problem.
    it('leaves the attestation dismissable, because nothing exists yet to lose', async () => {
      await start();

      expect(opened[0].config.closable).toBe(true);
    });

    /**
     * The hand-off waits for the attestation to be torn down, not merely closed.
     *
     * `close()` emits `onClose` synchronously and starts the leave animation from that same emission,
     * and the end of that animation drops `p-overflow-hidden` from the body. A dialog opened from
     * inside `onClose` therefore has its own scroll lock stripped a moment after it appears, and the
     * page scrolls behind it. The Me-lens hand-off found this first (#2066).
     */
    it('opens no hand-off until the attestation has torn down', async () => {
      await start();

      opened[0].onClose.next(attestations);
      expect(opened).toHaveLength(1);

      opened[0].onDestroy.next();
      expect(opened).toHaveLength(2);
    });

    // Nothing has been created at this point, and the confirmations are about a specific
    // organization's authority and export position — they cannot carry over to another company.
    it('closes the attestation on an organization switch, since no signature has been asked for yet', async () => {
      const fixture = await start();
      expect(opened).toHaveLength(1);

      selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(opened[0].close).toHaveBeenCalled();
    });

    // Angular reuses this component when only `:signatureId` changes, so an org-only stream never
    // fires and the attestation would survive onto an agreement it was never about — confirming it
    // then opens a session for the one the viewer navigated away from.
    it('closes the attestation when the viewer moves to another agreement', async () => {
      const fixture = await start();
      expect(opened).toHaveLength(1);

      paramMap.next(convertToParamMap({ signatureId: 'signature-uuid-2' }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(opened[0].close).toHaveBeenCalled();
    });

    /**
     * The hand-off is deliberately not closed.
     *
     * By the time it is open the request has been issued and a signature record and DocuSign envelope
     * exist for the organization that was selected when the viewer confirmed — which is the one they
     * meant to sign for. The address that comes back is the only thing that reaches them, so closing
     * this on a switch would orphan an envelope to save nothing. It is also why the field holding the
     * closeable ref is named for the uncommitted half.
     */
    it('leaves the hand-off standing, because a signing session already exists behind it', async () => {
      const fixture = await start();
      opened[0].onClose.next(attestations);
      opened[0].onDestroy.next();
      expect(opened).toHaveLength(2);

      selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(opened[1].close).not.toHaveBeenCalled();
    });
  });

  /**
   * Why the open tab holds nothing on an agreement nobody has signed, when signing is what fills it.
   */
  describe('the tabs signing is what fills', () => {
    const notStarted = { status: 'not-started' as const, signed: false, signedOn: undefined };

    it.each([['managers'], ['approval']] as const)('explains that the %s tab is waiting on the signature', async (tab) => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();
      byTestId(fixture, `org-easycla-detail-tab-${tab}`)?.click();
      fixture.detectChanges();

      expect(byTestId(fixture, 'org-easycla-detail-tab-locked')?.textContent).toContain(ORG_CLA_LOCKED_TAB_COPY[tab]?.title);
    });

    // Unbuilt for every agreement, signed or not — so "once this CLA is signed" would promise
    // content signing does not produce.
    it.each([['acknowledgments'], ['activity']] as const)('leaves the %s tab bare, since signing does not fill it', async (tab) => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();
      byTestId(fixture, `org-easycla-detail-tab-${tab}`)?.click();
      fixture.detectChanges();

      expect(byTestId(fixture, 'org-easycla-detail-tab-empty')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-tab-locked')).toBeNull();
    });

    /**
     * Read from `signed` rather than the status, as the download is and for the same reason:
     * sanctions occupy the single status slot, so a sanctioned agreement may be signed — and its CLA
     * Managers are real people who would be told they do not exist yet.
     */
    it('does not lock the managers tab on a signed agreement that is also sanctioned', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ status: 'sanctioned' })] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-tab-managers')?.click();
      fixture.detectChanges();

      expect(byTestId(fixture, 'org-easycla-detail-tab-locked')).toBeNull();
    });
  });

  it('withholds the download from an agreement that was never signed', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ status: 'not-started', signed: false, signedOn: undefined })] }));

    const fixture = await render();

    // The document does not exist for this row, so the control could do nothing but fail.
    expect(byTestId(fixture, 'org-easycla-detail-download')).toBeNull();
  });

  it('keeps the download on a signed agreement that is also sanctioned', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ status: 'sanctioned' })] }));

    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-download')).not.toBeNull();
  });

  it('withholds the download from a sanctioned agreement that was never signed', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ status: 'sanctioned', signed: false, signedOn: undefined })] }));

    const fixture = await render();

    // Sanctions win the single status slot, so `sanctioned` says nothing about signedness. This
    // row has no document, and reading the status alone would offer one.
    expect(byTestId(fixture, 'org-easycla-detail-download')).toBeNull();
  });

  it('opens Overview by default and leaves other tabs empty', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-overview')).toBeTruthy();

    byTestId(fixture, 'org-easycla-detail-tab-managers')?.click();
    fixture.detectChanges();

    expect(byTestId(fixture, 'org-easycla-detail-overview')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-detail-tab-empty')).toBeTruthy();
    expect(getPdfUrl).not.toHaveBeenCalled();
  });

  it('shows the manager count and approval count on the tab bar, and no acknowledgments count', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-managers')?.textContent?.trim()).toBe('2');
    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-approval')?.textContent?.trim()).toBe('7');
    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-acknowledgments')).toBeNull();
  });

  it('says the agreement was not found when the list loads without that row', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ id: 'other-signature' })] }));

    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-not-found-state')).toBeTruthy();
    expect(byTestId(fixture, 'org-easycla-detail-overview')).toBeNull();
  });

  it('surfaces a list failure instead of a missing agreement', async () => {
    getClaGroups.mockReturnValue(throwError(() => new Error('upstream')));

    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-error-state')).toBeTruthy();
    expect(byTestId(fixture, 'org-easycla-detail-not-found-state')).toBeNull();
  });

  it('downloads in-page after resolving the url, and does not resolve it on first paint', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, 'open');
    const fixture = await render();

    expect(getPdfUrl).not.toHaveBeenCalled();

    (byTestId(fixture, 'org-easycla-detail-download')?.querySelector('button') ?? byTestId(fixture, 'org-easycla-detail-download'))?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getPdfUrl).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1');
    expect(clickSpy).toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
    openSpy.mockRestore();
  });

  it('reports a failed download without opening a new context', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, 'open');
    getPdfUrl.mockReturnValue(throwError(() => ({ status: 403 })));

    const fixture = await render();
    (byTestId(fixture, 'org-easycla-detail-download')?.querySelector('button') ?? byTestId(fixture, 'org-easycla-detail-download'))?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(clickSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Download failed',
      })
    );
    clickSpy.mockRestore();
    openSpy.mockRestore();
  });

  it('abandons a download when the viewer switches organization mid-request', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const pdf = new Subject<{ url: string; expiresInSeconds: number }>();
    getPdfUrl.mockReturnValue(pdf);

    const fixture = await render();
    (byTestId(fixture, 'org-easycla-detail-download')?.querySelector('button') ?? byTestId(fixture, 'org-easycla-detail-download'))?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    // Without this, a button that failed to render would satisfy the assertion below for the
    // wrong reason: nothing subscribed, so nothing could have downloaded either way.
    expect(getPdfUrl).toHaveBeenCalledTimes(1);

    selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
    fixture.detectChanges();
    await fixture.whenStable();

    pdf.next({ url: 'https://s3.example.org/ccla.pdf', expiresInSeconds: 0 });
    fixture.detectChanges();
    await fixture.whenStable();

    // The response belongs to the organization the viewer has left, so it must not download.
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('abandons a download when the viewer clears the organization mid-request', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const pdf = new Subject<{ url: string; expiresInSeconds?: number }>();
    getPdfUrl.mockReturnValue(pdf);

    const fixture = await render();
    (byTestId(fixture, 'org-easycla-detail-download')?.querySelector('button') ?? byTestId(fixture, 'org-easycla-detail-download'))?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getPdfUrl).toHaveBeenCalledTimes(1);

    selectedAccount.set(null);
    fixture.detectChanges();
    await fixture.whenStable();

    pdf.next({ url: 'https://s3.example.org/ccla.pdf' });
    fixture.detectChanges();
    await fixture.whenStable();

    // Clearing empties the page exactly as switching does, so the response is just as stale. A
    // cancellation stream that filters out the empty selection would let this one through.
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('abandons a download when the viewer opens another agreement mid-request', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const pdf = new Subject<{ url: string; expiresInSeconds?: number }>();
    getPdfUrl.mockReturnValue(pdf);
    getClaGroups.mockReturnValue(
      of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(), claGroup({ id: 'signature-uuid-2', claGroupName: 'Other CLA' })] })
    );

    const fixture = await render();
    (byTestId(fixture, 'org-easycla-detail-download')?.querySelector('button') ?? byTestId(fixture, 'org-easycla-detail-download'))?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getPdfUrl).toHaveBeenCalledTimes(1);

    // Angular reuses this component when only `:signatureId` changes, so the organization never
    // changes and an org-only cancellation stream would not fire.
    paramMap.next(convertToParamMap({ signatureId: 'signature-uuid-2' }));
    fixture.detectChanges();
    await fixture.whenStable();

    pdf.next({ url: 'https://s3.example.org/ccla.pdf' });
    fixture.detectChanges();
    await fixture.whenStable();

    // The response is the first agreement's document, and the page is now showing the second.
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('switches agreement from the list already loaded, without refetching it', async () => {
    getClaGroups.mockReturnValue(
      of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(), claGroup({ id: 'signature-uuid-2', claGroupName: 'Other CLA' })] })
    );

    const fixture = await render();
    expect(getClaGroups).toHaveBeenCalledTimes(1);

    paramMap.next(convertToParamMap({ signatureId: 'signature-uuid-2' }));
    fixture.detectChanges();
    await fixture.whenStable();

    // The response is the organization's whole list, so it already holds the second agreement.
    // Refetching it would raise the skeleton over the page to arrive at rows it is already showing.
    expect(getClaGroups).toHaveBeenCalledTimes(1);
    expect(byTestId(fixture, 'org-easycla-detail-ccla-title')?.textContent).toContain('Other CLA');
  });

  it('holds the skeleton while the loaded list still belongs to the previous organization', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: '0014100000OtherOrgAA', claGroups: [claGroup()] }));

    const fixture = await render();

    // The response names a different organization than the one selected. Rendering it would show
    // that organization's agreement, signer and covered projects under this organization's name.
    expect(byTestId(fixture, 'org-easycla-detail-ccla-title')).toBeNull();
  });

  describe('tab bar keyboard navigation', () => {
    function pressOnTabs(fixture: ComponentFixture<OrgEasyclaDetailComponent>, key: string): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      byTestId(fixture, 'org-easycla-detail-tabs')?.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    }

    it('exposes the strip as a tablist with the selected tab as the only tab stop', async () => {
      const fixture = await render();

      expect(byTestId(fixture, 'org-easycla-detail-tabs')?.getAttribute('role')).toBe('tablist');
      expect(byTestId(fixture, 'org-easycla-detail-tab-overview')?.getAttribute('aria-selected')).toBe('true');
      expect(byTestId(fixture, 'org-easycla-detail-tab-overview')?.getAttribute('tabindex')).toBe('0');
      expect(byTestId(fixture, 'org-easycla-detail-tab-managers')?.getAttribute('tabindex')).toBe('-1');
    });

    it('points only the selected tab at a panel, since only its panel exists', async () => {
      const fixture = await render();

      const panelId = byTestId(fixture, 'org-easycla-detail-tab-overview')?.getAttribute('aria-controls');
      expect(panelId).toBe('org-easycla-detail-tab-panel-overview');
      expect(fixture.nativeElement.querySelector(`#${panelId}`)).not.toBeNull();

      // The unselected tabs carry no `aria-controls` at all. One panel is in the DOM at a time, so
      // an unselected tab advertising one names an id that does not exist — worse than an absent
      // attribute, because a screen reader following it lands nowhere.
      expect(fixture.nativeElement.querySelectorAll('[role="tab"][aria-selected="false"][aria-controls]')).toHaveLength(0);
    });

    it('moves to the next tab on ArrowRight and claims the keystroke', async () => {
      const fixture = await render();

      const event = pressOnTabs(fixture, 'ArrowRight');

      expect(byTestId(fixture, 'org-easycla-detail-tab-managers')?.getAttribute('aria-selected')).toBe('true');
      expect(byTestId(fixture, 'org-easycla-detail-tab-managers')?.getAttribute('tabindex')).toBe('0');
      expect(event.defaultPrevented).toBe(true);
    });

    it('wraps backwards from the first tab to the last on ArrowLeft', async () => {
      const fixture = await render();

      pressOnTabs(fixture, 'ArrowLeft');

      expect(byTestId(fixture, 'org-easycla-detail-tab-activity')?.getAttribute('aria-selected')).toBe('true');
    });

    it('jumps to the last tab on End and back to the first on Home', async () => {
      const fixture = await render();

      pressOnTabs(fixture, 'End');
      expect(byTestId(fixture, 'org-easycla-detail-tab-activity')?.getAttribute('aria-selected')).toBe('true');

      pressOnTabs(fixture, 'Home');
      expect(byTestId(fixture, 'org-easycla-detail-tab-overview')?.getAttribute('aria-selected')).toBe('true');
      expect(byTestId(fixture, 'org-easycla-detail-overview')).toBeTruthy();
    });

    it('leaves the selection alone for a key the strip does not handle', async () => {
      const fixture = await render();

      const event = pressOnTabs(fixture, 'ArrowDown');

      expect(byTestId(fixture, 'org-easycla-detail-tab-overview')?.getAttribute('aria-selected')).toBe('true');
      expect(event.defaultPrevented).toBe(false);
    });
  });

  // The fixture row carries a foundation AND two projects, so it renders both kinds of chip. Only
  // the projects one may be a control: an activatable foundation name promises a list of what the
  // foundation holds, and would open the list of what this one agreement covers instead.
  it('offers the foundation as a plain chip and the project count as the only control', async () => {
    const fixture = await render();
    const controls = fixture.nativeElement.querySelectorAll('[data-testid="org-easycla-detail-coverage"]');
    const statics = fixture.nativeElement.querySelectorAll('[data-testid="org-easycla-detail-coverage-static"]');

    expect(Array.from(controls).map((el) => (el as HTMLElement).textContent?.trim())).toEqual(['Covers 2 projects']);
    expect(Array.from(statics).map((el) => (el as HTMLElement).textContent?.trim())).toEqual(['Nimbus Foundation']);
    expect((statics[0] as HTMLElement).tagName).toBe('SPAN');
    expect((statics[0] as HTMLElement).querySelector('a, button')).toBeNull();
  });

  it('opens the coverage dialog from a header chip', async () => {
    const fixture = await render();

    byTestId(fixture, 'org-easycla-detail-coverage')?.click();
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
});
