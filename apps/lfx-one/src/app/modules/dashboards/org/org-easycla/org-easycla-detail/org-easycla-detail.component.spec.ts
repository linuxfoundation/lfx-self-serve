// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, Navigation, provideRouter, Router } from '@angular/router';
import {
  CCLA_SIGN_COPY,
  ORG_CLA_LOCKED_TAB_COPY,
  ORG_CLA_MANAGERS_COPY,
  ORG_CLA_NOT_STARTED_COPY,
  ORG_CLA_SIGN_SELECTION_STATE,
  ORG_EASYCLA_RETURN_ORG_PARAM,
  ORG_EASYCLA_RETURN_SIGNED_PARAM,
} from '@lfx-one/shared/constants';
import type { OrgClaGroup, OrgClaGroupList, OrgClaSignSelection, OrgItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { UserService } from '@services/user.service';
import { OrgNavigationService } from '@shared/services/org-navigation.service';
import type { Confirmation } from 'primeng/api';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { OrgEasyclaCoverageDialogComponent } from '../org-easycla-coverage-dialog/org-easycla-coverage-dialog.component';
import { OrgEasyclaAttestationComponent } from '../org-easycla-sign/org-easycla-attestation.component';
import { OrgEasyclaSendByEmailComponent } from '../org-easycla-sign/org-easycla-send-by-email.component';
import { OrgEasyclaSignHandoffComponent } from '../org-easycla-sign/org-easycla-sign-handoff.component';
import { OrgEasyclaDetailComponent } from './org-easycla-detail.component';

// CLA-Group-shaped, because both the signed-row lookup and the preview-selection gate match
// canonically — the producer emits one id hyphenated or compact, in either case. A readable
// stand-in that is not UUID-shaped canonicalises to nothing, so it would silently take the
// never-matches path through every case below.
const GROUP_ID = '7c1a9000-0000-4000-8000-000000000001';
const ELSEWHERE_GROUP_ID = '7c1a9000-0000-4000-8000-000000000002';
const UNHELD_GROUP_ID = '7c1a9000-0000-4000-8000-000000000003';

describe('OrgEasyclaDetailComponent', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000AcmeOrgAAA', accountName: 'Acme' };
  const OTHER_ORG = { uid: '0014100000OtherOrgAA', accountName: 'Other' };

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(null);
  /** Which mount the page is rendered under: the legacy `/org/easycla/…` (no `orgSegment` ancestor) or `/org/{segment}/easycla/…`. */
  let orgSegment: string | null = null;
  const mountPath = (): { paramMap: ReturnType<typeof convertToParamMap> }[] => [
    { paramMap: convertToParamMap(orgSegment ? { orgSegment } : {}) },
    { paramMap: paramMap.value },
  ];
  // Mirrors AccountContextService.selectedUrlSegment: the SFID, since these accounts carry no slug.
  const selectedUrlSegment = computed(() => selectedAccount()?.uid ?? null);
  const hasOrgSelectorAccess = signal(true);
  const grantsLoaded = signal(true);
  const personaLoaded = signal(true);
  const navLoaded = signal(true);
  const correlationId = signal<string | null>(null);
  // The page-level classifier, reduced to the one branch these scenarios drive: settled and holding nothing.
  const pageState = computed(() => (grantsLoaded() && personaLoaded() && !hasOrgSelectorAccess() ? 'no-organization' : null));
  const emptyStateService = {
    pageState,
    hasPageState: computed(() => pageState() !== null),
    settled: computed(() => grantsLoaded() && personaLoaded()),
    // Mirrors OrgLensEmptyStateService.pageReady: settled, plus the org list when the caller has one.
    pageReady: computed(() => grantsLoaded() && personaLoaded() && (!hasOrgSelectorAccess() || navLoaded())),
    retry: vi.fn(),
  };
  // Both halves of the address (#2364): the CLA Group in the path, and the signature that narrows
  // it in the query. Separate subjects because they change independently — a card click sets both,
  // and moving between two signing entities' agreements changes only the query.
  const paramMap = new BehaviorSubject(convertToParamMap({ claGroupId: GROUP_ID }));
  const queryParamMap = new BehaviorSubject(convertToParamMap({ sig: 'signature-uuid-1' }));

  const getClaGroups = vi.fn();
  const getPdfUrl = vi.fn();
  const getCclaPreview = vi.fn();
  const getApprovalList = vi.fn();
  const updateApprovalList = vi.fn();
  const checkPermission = vi.fn();
  const getContributorAcknowledgments = vi.fn();
  const getManagers = vi.fn();
  const addManager = vi.fn();
  const removeManager = vi.fn();
  const invalidateAcknowledgment = vi.fn();
  const getActivityLog = vi.fn();
  const setAutoCreateEcla = vi.fn();
  const addMessage = vi.fn();
  const openDialog = vi.fn();
  const setDialogPt = vi.fn();

  /** Where the page tried to go. Installed by `render` on the real router; see the spy there. */
  let navigate: MockInstance<Router['navigate']>;

  function claGroup(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupName: 'Nimbus Foundation CLA',
      claGroupId: GROUP_ID,
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
        {
          provide: ActivatedRoute,
          useValue: { paramMap, queryParamMap, snapshot: { paramMap: paramMap.value, queryParamMap: queryParamMap.value, pathFromRoot: mountPath() } },
        },
        { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess, selectedUrlSegment } },
        { provide: OrgRoleGrantsService, useValue: { loaded: grantsLoaded, correlationId } },
        { provide: PersonaService, useValue: { personaLoaded } },
        { provide: OrgNavigationService, useValue: { loaded: navLoaded } },
        { provide: OrgLensEmptyStateService, useValue: emptyStateService },
        {
          provide: OrgLensClaService,
          useValue: {
            getClaGroups,
            getPdfUrl,
            getCclaPreview,
            getApprovalList,
            updateApprovalList,
            checkPermission,
            getContributorAcknowledgments,
            getManagers,
            addManager,
            removeManager,
            invalidateAcknowledgment,
            getActivityLog,
            setAutoCreateEcla,
          },
        },
        { provide: MessageService, useValue: { add: addMessage } },
        { provide: UserService, useValue: { viewerUsername: signal(null) } },
        ConfirmationService,
      ],
    }).compileComponents();

    TestBed.overrideComponent(OrgEasyclaDetailComponent, {
      set: {
        providers: [
          {
            provide: DialogService,
            useValue: { open: openDialog, dialogComponentRefMap: { get: () => ({ setInput: setDialogPt, changeDetectorRef: { detectChanges: vi.fn() } }) } },
          },
        ],
      },
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

  function identifySomeoneElse(fixture: ComponentFixture<OrgEasyclaDetailComponent>): HTMLButtonElement | null {
    return byTestId(fixture, 'org-easycla-detail-identify-someone-else') as HTMLButtonElement | null;
  }

  /** Unavailable to activate, but still in the tab order so the aria-label reason is reachable. */
  function identifyIsUnavailable(button: HTMLButtonElement | null): boolean {
    return !!button && button.disabled === false && button.getAttribute('aria-disabled') === 'true';
  }

  function identifyIsOffered(button: HTMLButtonElement | null): boolean {
    return !!button && button.disabled === false && button.getAttribute('aria-disabled') !== 'true';
  }

  beforeEach(() => {
    orgSegment = null;
    selectedAccount.set(SELECTED_ACCOUNT);
    hasOrgSelectorAccess.set(true);
    grantsLoaded.set(true);
    personaLoaded.set(true);
    navLoaded.set(true);
    paramMap.next(convertToParamMap({ claGroupId: GROUP_ID }));
    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-1' }));
    getClaGroups.mockReset();
    getPdfUrl.mockReset();
    getCclaPreview.mockReset();
    getManagers.mockReset();
    getManagers.mockReturnValue(of({ signatureId: 'signature-uuid-1', managers: [] }));
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup()] }));
    getPdfUrl.mockReturnValue(of({ url: 'https://s3.example.org/ccla.pdf', expiresInSeconds: 0 }));
    getCclaPreview.mockReturnValue(of(new Blob(['%PDF-1.4'], { type: 'application/pdf' })));
    getApprovalList.mockReset();
    updateApprovalList.mockReset();
    getApprovalList.mockReturnValue(of({ signatureId: 'signature-uuid-1', entries: [], canEdit: true }));
    getContributorAcknowledgments.mockReset();
    getContributorAcknowledgments.mockReturnValue(
      of({ signatureId: 'signature-uuid-1', list: [], canEdit: true, resultCount: 0, totalCount: 4, nextKey: null })
    );
    updateApprovalList.mockReturnValue(of({ signatureId: 'signature-uuid-1', entries: [], canEdit: true }));
    checkPermission.mockReset();
    checkPermission.mockReturnValue(of(true));
    invalidateAcknowledgment.mockReset();
    getActivityLog.mockReset();
    getActivityLog.mockReturnValue(of({ signatureId: 'signature-uuid-1', list: [], resultCount: 0, nextKey: null }));
    setAutoCreateEcla.mockReset();
    setAutoCreateEcla.mockReturnValue(of({ autoCreateEcla: true }));
    addMessage.mockReset();
    openDialog.mockReset();
    setDialogPt.mockReset();
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

    it('offers the review-copy download after the steps and before Start', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();
      const panel = byTestId(fixture, 'org-easycla-detail-not-started');
      const review = byTestId(fixture, 'org-easycla-detail-review-copy');
      const start = byTestId(fixture, 'org-easycla-detail-start-cla');
      const steps = panel?.querySelector('ol');

      expect(review?.textContent?.replace(/\s+/g, ' ').trim()).toBe(ORG_CLA_NOT_STARTED_COPY.downloadLabel);
      expect(review?.getAttribute('aria-label')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-download')).toBeNull();
      expect(steps && review && steps.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(review && start && review.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('downloads the review copy for the CLA Group, not the signature id', async () => {
      let savedName: string | undefined;
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        savedName = this.download;
      });
      const createObjectURL = vi.fn(() => 'blob:review-copy');
      const revokeObjectURL = vi.fn();
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
      URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;
      const preview$ = new Subject<Blob>();
      getCclaPreview.mockReturnValue(preview$.asObservable());
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      try {
        const fixture = await render();
        const review = byTestId(fixture, 'org-easycla-detail-review-copy');
        expect(review?.getAttribute('aria-busy')).toBe('false');
        review?.click();
        fixture.detectChanges();
        expect(review?.getAttribute('aria-busy')).toBe('true');

        preview$.next(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
        preview$.complete();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(getCclaPreview).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, GROUP_ID);
        expect(getPdfUrl).not.toHaveBeenCalled();
        expect(createObjectURL).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();
        expect(savedName).toBe('Nimbus_Foundation_CLA-ccla-review.pdf');
        expect(review?.getAttribute('aria-busy')).toBe('false');

        // The component revokes the blob URL on a macrotask so the download can start first.
        // Flush that before restoring URL — jsdom's URL has no revokeObjectURL, and an
        // unrestored timeout becomes an unhandled exception in the next test.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:review-copy');
      } finally {
        clickSpy.mockRestore();
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
      }
    });

    it('toasts when the review copy is refused and leaves Start available', async () => {
      getCclaPreview.mockReturnValue(throwError(() => ({ status: 400 })));
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-review-copy')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Download failed' }));
      expect(byTestId(fixture, 'org-easycla-detail-review-copy')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.disabled).toBe(false);
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

      const identify = identifySomeoneElse(fixture);
      expect(identify?.getAttribute('aria-label')).toContain(ORG_CLA_NOT_STARTED_COPY.identifySomeoneElseLabel);
      expect(identify?.getAttribute('aria-label')).toContain(CCLA_SIGN_COPY.picker.multiProjectDisabledReason);
      expect(identify?.getAttribute('aria-label')).not.toContain(ORG_CLA_NOT_STARTED_COPY.startLabel);
    });

    /**
     * Native `disabled` takes the control out of the tab order, so the reason on aria-label is
     * unreachable from the keyboard. aria-disabled keeps it focusable; the click still refuses.
     */
    it('keeps Identify someone else in the tab order while it is unavailable, so the reason is reachable', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();
      const identify = identifySomeoneElse(fixture);

      expect(identifyIsUnavailable(identify)).toBe(true);
      identify?.click();
      expect(openDialog).not.toHaveBeenCalled();
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
      expect(checkPermission).not.toHaveBeenCalled();
    });

    it('opens the send-by-email dialog from Identify someone else, without attestation', async () => {
      openDialog.mockReturnValue({ onClose: of(null), onDestroy: of(undefined), close: vi.fn() });
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-identify-someone-else')?.click();

      expect(openDialog).toHaveBeenCalledTimes(1);
      expect(openDialog.mock.calls[0][0]).toBe(OrgEasyclaSendByEmailComponent);
      expect(openDialog.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            orgUid: SELECTED_ACCOUNT.uid,
            companyName: SELECTED_ACCOUNT.accountName,
            projectSfid: 'a09410000182dD2AAI',
          }),
        })
      );
    });

    it('closes the send-by-email dialog on an organization switch, since no mail has been sent yet', async () => {
      const onClose = new Subject<unknown>();
      const onDestroy = new Subject<void>();
      const close = vi.fn();
      openDialog.mockReturnValue({ onClose, onDestroy, close });
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-identify-someone-else')?.click();
      expect(openDialog).toHaveBeenCalledTimes(1);

      selectedAccount.set(OTHER_ORG);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(close).toHaveBeenCalled();
    });

    /**
     * Once Send has posted, this is the same committed shape as the self-sign hand-off: a
     * signature is being created for the organization that was selected. Closing it on a switch
     * would unsubscribe a request EasyCLA may already have accepted, hide Email Sent, and let
     * the manager send a second copy.
     */
    it('leaves send-by-email standing once Send has started, because the request is already with EasyCLA', async () => {
      const onClose = new Subject<unknown>();
      const onDestroy = new Subject<void>();
      const close = vi.fn();
      openDialog.mockReturnValue({ onClose, onDestroy, close });
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-identify-someone-else')?.click();
      expect(openDialog).toHaveBeenCalledTimes(1);

      const opened = openDialog.mock.calls[0][1] as { data?: { onRequestStarted?: () => void } };
      opened.data?.onRequestStarted?.();

      selectedAccount.set(OTHER_ORG);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(close).not.toHaveBeenCalled();
    });

    it('does not offer Identify someone else again after the mail has been sent', async () => {
      const onClose = new Subject<unknown>();
      const onDestroy = new Subject<void>();
      openDialog.mockReturnValue({ onClose, onDestroy, close: vi.fn() });
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-identify-someone-else')?.click();
      expect(openDialog).toHaveBeenCalledTimes(1);

      const opened = openDialog.mock.calls[0][1] as { data?: { onMailed?: () => void } };
      opened.data?.onMailed?.();
      onClose.next(null);
      onDestroy.next();
      fixture.detectChanges();

      const identify = identifySomeoneElse(fixture);
      expect(identifyIsUnavailable(identify)).toBe(true);
      expect(identify?.getAttribute('aria-label')).toContain('a signature request has already been emailed');
      expect(byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.disabled).toBe(true);
    });

    it('still offers Identify someone else on a different CLA Group after this one was emailed', async () => {
      const onClose = new Subject<unknown>();
      const onDestroy = new Subject<void>();
      openDialog.mockReturnValue({ onClose, onDestroy, close: vi.fn() });
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      const other = {
        ...notStarted,
        id: 'signature-uuid-elsewhere',
        claGroupId: ELSEWHERE_GROUP_ID,
        claGroupName: 'Elsewhere CLA',
        projects: [{ projectName: 'Driftwood', projectSfid: 'a09410000182dELSE' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable), claGroup(other)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-identify-someone-else')?.click();
      const opened = openDialog.mock.calls[0][1] as { data?: { onMailed?: () => void } };
      opened.data?.onMailed?.();
      onClose.next(null);
      onDestroy.next();
      fixture.detectChanges();
      expect(identifyIsUnavailable(identifySomeoneElse(fixture))).toBe(true);

      paramMap.next(convertToParamMap({ claGroupId: ELSEWHERE_GROUP_ID }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(identifyIsOffered(identifySomeoneElse(fixture))).toBe(true);
      expect(byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.disabled).toBe(false);
    });

    /**
     * Emailing a second group is deliberately allowed, so the lock cannot be one slot: A → B → A
     * would forget A. Nothing refetches on a route change — the list is keyed on organization and
     * holds neither agreement — so returning to A is the moment a duplicate CCLA goes out.
     */
    it('keeps the first group locked after a second group is emailed and the route returns', async () => {
      const dialogs: { onClose: Subject<unknown>; onDestroy: Subject<void> }[] = [];
      openDialog.mockImplementation(() => {
        const ref = { onClose: new Subject<unknown>(), onDestroy: new Subject<void>() };
        dialogs.push(ref);
        return { ...ref, close: vi.fn() };
      });
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      const other = {
        ...notStarted,
        id: 'signature-uuid-elsewhere',
        claGroupId: ELSEWHERE_GROUP_ID,
        claGroupName: 'Elsewhere CLA',
        projects: [{ projectName: 'Driftwood', projectSfid: 'a09410000182dELSE' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable), claGroup(other)] }));

      const fixture = await render();
      const identify = (): HTMLButtonElement | null => identifySomeoneElse(fixture);
      const mailTheDisplayedGroup = async (nth: number): Promise<void> => {
        identify()?.click();
        const opened = openDialog.mock.calls[nth][1] as { data?: { onMailed?: () => void } };
        opened.data?.onMailed?.();
        dialogs[nth].onClose.next(null);
        dialogs[nth].onDestroy.next();
        fixture.detectChanges();
        await fixture.whenStable();
      };
      const addressGroup = async (claGroupId: string): Promise<void> => {
        paramMap.next(convertToParamMap({ claGroupId }));
        fixture.detectChanges();
        await fixture.whenStable();
      };

      await mailTheDisplayedGroup(0);

      await addressGroup(ELSEWHERE_GROUP_ID);
      expect(identifyIsOffered(identify())).toBe(true);
      await mailTheDisplayedGroup(1);
      expect(identifyIsUnavailable(identify())).toBe(true);

      await addressGroup(GROUP_ID);

      expect(identifyIsUnavailable(identify())).toBe(true);
      expect(byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.disabled).toBe(true);
    });

    it('still offers Identify someone else after Close when the mail was not sent', async () => {
      const onClose = new Subject<unknown>();
      const onDestroy = new Subject<void>();
      openDialog.mockReturnValue({ onClose, onDestroy, close: vi.fn() });
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-identify-someone-else')?.click();
      onClose.next(null);
      onDestroy.next();
      fixture.detectChanges();

      expect(identifyIsOffered(identifySomeoneElse(fixture))).toBe(true);
      expect(byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.disabled).toBe(false);
    });

    it('opens the send-by-email dialog after I am not authorized, not the self-sign hand-off', async () => {
      const attestationOnClose = new Subject<unknown>();
      const attestationOnDestroy = new Subject<void>();
      const opened: unknown[] = [];
      openDialog.mockImplementation((component: unknown) => {
        opened.push(component);
        return {
          onClose: opened.length === 1 ? attestationOnClose : of(null),
          onDestroy: opened.length === 1 ? attestationOnDestroy : of(undefined),
          close: vi.fn(),
        };
      });
      const signable = {
        ...notStarted,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.click();
      fixture.detectChanges();

      attestationOnClose.next({ sendByEmail: true });
      attestationOnDestroy.next();
      fixture.detectChanges();

      expect(opened).toEqual([OrgEasyclaAttestationComponent, OrgEasyclaSendByEmailComponent]);
      expect(opened).not.toContain(OrgEasyclaSignHandoffComponent);
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
        claGroupId: GROUP_ID,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.click();
      fixture.detectChanges();

      attestationOnClose.next(attestations);
      // Between onClose and onDestroy, the viewer switches organizations. The click captured the
      // Acme uid; opening the hand-off now would sign Acme's CCLA for a different company.
      selectedAccount.set(OTHER_ORG);
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

      const initial = { ...notStarted, claGroupId: GROUP_ID, projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }] };
      const groups = new BehaviorSubject({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(initial)] });
      getClaGroups.mockReturnValue(groups);

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.click();
      fixture.detectChanges();

      attestationOnClose.next(attestations);
      // Between onClose and onDestroy, a fresh list arrives holding nothing for the CLA Group this
      // address names. Opening the hand-off against the captured choice would start a signing
      // session for an agreement the page can no longer show.
      //
      // This is what the race looks like since #2364. It used to be a row whose claGroupId differed
      // from the page's, which the addressing now prevents outright — the address *is* the group,
      // so no row the page resolves can disagree with it. What can still change is whether a row
      // for that group is there at all.
      groups.next({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ ...notStarted, claGroupId: ELSEWHERE_GROUP_ID })] });
      attestationOnDestroy.next();
      fixture.detectChanges();

      expect(opened).toEqual([OrgEasyclaAttestationComponent]);
      expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).toBeTruthy();
    });

    it('hands the confirmations to the signing step for this agreement', async () => {
      const attestations = { authorityAcked: true, embargoAcked: true };
      const opened: { component: unknown; config: { data?: unknown; closable?: boolean; showHeader?: boolean; ariaLabelledBy?: string } }[] = [];
      openDialog.mockImplementation(
        (component: unknown, config: { data?: unknown; closable?: boolean; showHeader?: boolean; ariaLabelledBy?: string } = {}) => {
          opened.push({ component, config });
          const result = opened.length === 1 ? attestations : null;
          return { onClose: of(result), onDestroy: of(undefined), close: vi.fn() };
        }
      );

      const signable = {
        ...notStarted,
        claGroupId: GROUP_ID,
        projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      };
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(signable)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.click();

      expect(opened).toHaveLength(2);
      expect(opened[1].component).toBe(OrgEasyclaSignHandoffComponent);
      expect(opened[1].config.showHeader).toBe(false);
      expect(opened[1].config.ariaLabelledBy).toBeUndefined();
      expect(setDialogPt).toHaveBeenCalledWith('pt', {
        pcDialog: { root: { 'aria-labelledby': OrgEasyclaSignHandoffComponent.headingId } },
      });
      expect(opened[1].config.data).toEqual({
        orgUid: SELECTED_ACCOUNT.uid,
        projectSfid: 'a09410000182dD2AAI',
        claGroupId: GROUP_ID,
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
        claGroupId: GROUP_ID,
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
      expect(opened[1].config.data).toMatchObject({ projectSfid: 'a09410000182dFOUND', claGroupId: GROUP_ID });
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
   * Since #2364 it shares its address with the agreement view, so these cases sit at the chosen
   * group's own address with no signature in the query, against a list holding nothing for that
   * group. The agreement itself is still built entirely from the choice the navigation carried —
   * there is no fetch-a-CLA-group-by-id endpoint upstream — but the list is now requested, because
   * it is what decides between this preview and an agreement the organization already holds.
   */
  describe('previewing a CLA Group the picker chose', () => {
    const PREVIEW_GROUP_ID = '7c1a9000-0000-4000-8000-000000000004';

    const CASCADE: OrgClaSignSelection = {
      claGroupId: PREVIEW_GROUP_ID,
      claGroupName: 'Cascade CLA',
      projectSfid: 'a09410000182dD2AAI',
      projectName: 'Cascade',
      orgUid: SELECTED_ACCOUNT.uid,
    };

    function previewing(selection: Partial<OrgClaSignSelection> = {}): Record<string, unknown> {
      return { [ORG_CLA_SIGN_SELECTION_STATE]: { ...CASCADE, ...selection } };
    }

    beforeEach(() => {
      // The chosen group's address, and nothing in the query to narrow it. The default list holds
      // a different group, so nothing signed answers this address.
      paramMap.next(convertToParamMap({ claGroupId: PREVIEW_GROUP_ID }));
      queryParamMap.next(convertToParamMap({}));
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

    /**
     * The list is requested here since #2364, and that is the point: it is what decides between
     * this preview and an agreement the organization already holds. What must not survive is
     * either row-shaped empty state — `notFound` or `cannotPreview` firing over a preview would
     * tell a signatory the agreement they are about to sign does not exist.
     */
    it('asks for the list, yet settles on the preview rather than an empty state', async () => {
      const fixture = await render(previewing());

      expect(getClaGroups).toHaveBeenCalled();
      expect(byTestId(fixture, 'org-easycla-detail-list-loading')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-not-found-state')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Cascade CLA');
    });

    it('renders the preview when the route and the selection spell the same group differently', async () => {
      const fixture = await render(previewing({ claGroupId: PREVIEW_GROUP_ID.replaceAll('-', '') }));

      expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Cascade CLA');
      expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).toBeNull();
    });

    /**
     * A signatory who signs and returns to this address still carries the selection in history.
     * The agreement they now hold has to win — telling them it is not yet signed would be false.
     */
    it('yields to an agreement the organization has since signed for that group', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ claGroupId: PREVIEW_GROUP_ID, claGroupName: 'Cascade CLA' })] }));

      const fixture = await render(previewing());

      expect(byTestId(fixture, 'org-easycla-detail-status')?.textContent).toContain('Signed');
      expect(byTestId(fixture, 'org-easycla-detail-not-started')).toBeNull();
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

    /**
     * A pasted, bookmarked or linked group address arrives with nothing, and nothing here can
     * rebuild it — the list read returns signed agreements only, and there is no
     * fetch-a-group-by-id read to fall back on.
     *
     * It now stays on that address rather than redirecting to the list (#2364), because the group
     * address is the one a named signing overview will claim and the list is not an answer to it.
     */
    it('stays on the address when it carries no selection, rather than leaving for the list', async () => {
      const fixture = await render();

      expect(navigate).not.toHaveBeenCalled();
      expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-not-found-state')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-header')).toBeNull();
    });

    /**
     * A truncated selection is treated as no selection at all.
     *
     * The value comes back out of a history entry, so it can have been written by an earlier
     * deployment. Trusted, a partial one heads the page with an undefined name and still offers
     * Start — a missing project SFID only disables signing once something reads it.
     */
    it.each([['claGroupId'], ['claGroupName'], ['projectSfid'], ['projectName'], ['orgUid']] as const)(
      'renders no preview when %s is missing',
      async (field) => {
        const fixture = await render(previewing({ [field]: '' }));

        expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).not.toBeNull();
        expect(byTestId(fixture, 'org-easycla-detail-header')).toBeNull();
      }
    );

    /**
     * The gate that replaced the removed route-shape test (#2364). Both modes now share
     * `/org/easycla/:claGroupId`, so the presence of a `signatureId` parameter is no longer a
     * this-is-an-agreement signal — and it was load-bearing: the previous route's `history.state`
     * is still what the location returns until Angular has written the new entry, so without a
     * gate a stale selection would latch under an unrelated group.
     */
    it('refuses a selection that names a different CLA Group than the address', async () => {
      const fixture = await render(previewing({ claGroupId: ELSEWHERE_GROUP_ID }));

      expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).not.toBeNull();
      // Nothing of the preview renders, so the refused name cannot have reached the heading.
      expect(byTestId(fixture, 'org-easycla-detail-header')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('Cascade CLA');
    });

    // The same refusal for a restored history entry, which is the path that actually produces a
    // stale selection — there is no in-flight navigation to carry a fresh one.
    it('refuses a restored selection that names a different CLA Group', async () => {
      const fixture = await render(undefined, previewing({ claGroupId: ELSEWHERE_GROUP_ID }));

      expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).not.toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });

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

      selectedAccount.set(OTHER_ORG);
      fixture.detectChanges();
      await fixture.whenStable();

      // The list of the organization now selected: the address follows the selection (spec 050 US2).
      expect(navigate).toHaveBeenCalledWith(['/org', OTHER_ORG.uid, 'easycla'], { replaceUrl: true });
    });

    /**
     * The unsigned overview is this preview. Leaving for the list while Send is in flight would
     * destroy the component-scoped DialogService, unsubscribe the POST, hide Email Sent, and
     * let the manager send a second copy. Stay until the dialog closes, then leave.
     */
    it('keeps send-by-email standing on a preview organization switch once Send has started, then leaves when it closes', async () => {
      const onClose = new Subject<unknown>();
      const onDestroy = new Subject<void>();
      const close = vi.fn();
      openDialog.mockReturnValue({ onClose, onDestroy, close });

      const fixture = await render(previewing());
      byTestId(fixture, 'org-easycla-detail-identify-someone-else')?.click();
      expect(openDialog).toHaveBeenCalledTimes(1);

      const opened = openDialog.mock.calls[0][1] as { data?: { onRequestStarted?: () => void } };
      opened.data?.onRequestStarted?.();

      selectedAccount.set(OTHER_ORG);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(close).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();

      onClose.next(null);
      onDestroy.next();
      fixture.detectChanges();
      await fixture.whenStable();

      // The list of the organization now selected: the address follows the selection (spec 050 US2).
      expect(navigate).toHaveBeenCalledWith(['/org', OTHER_ORG.uid, 'easycla'], { replaceUrl: true });
    });

    /**
     * Continue / I am not authorized spends `take(1)` on the organization stream while
     * `signingOpen` is still true, then `whenSigningDialogEnds` treats the close as handed-off
     * and will not leave. The next-step check is the remaining chance: if it drops the lock
     * without leaving, the picker preview stays under the wrong company.
     */
    it('leaves a mismatched preview when Continue cannot open the next step', async () => {
      const onClose = new Subject<unknown>();
      const onDestroy = new Subject<void>();
      openDialog.mockReturnValue({ onClose, onDestroy, close: vi.fn() });

      const fixture = await render(previewing());
      byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.click();
      expect(openDialog).toHaveBeenCalledTimes(1);

      onClose.next({ sendByEmail: true });

      selectedAccount.set(OTHER_ORG);
      fixture.detectChanges();
      await fixture.whenStable();

      onDestroy.next();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(openDialog).toHaveBeenCalledTimes(1);
      // The list of the organization now selected: the address follows the selection (spec 050 US2).
      expect(navigate).toHaveBeenCalledWith(['/org', OTHER_ORG.uid, 'easycla'], { replaceUrl: true });
    });

    /**
     * The picker preview is captured at construction and is not refreshed when `:claGroupId`
     * changes. A reused instance that then addresses a group not on the list keeps showing the
     * emailed agreement. The lock must follow that displayed group, not the route — otherwise it
     * lifts and Close can send a second copy of the same CCLA.
     */
    it('keeps Identify someone else disabled when the route moves but the preview still shows the emailed group', async () => {
      const onClose = new Subject<unknown>();
      const onDestroy = new Subject<void>();
      openDialog.mockReturnValue({ onClose, onDestroy, close: vi.fn() });

      const fixture = await render(previewing());
      byTestId(fixture, 'org-easycla-detail-identify-someone-else')?.click();
      const opened = openDialog.mock.calls[0][1] as { data?: { onMailed?: () => void } };
      opened.data?.onMailed?.();
      onClose.next(null);
      onDestroy.next();
      fixture.detectChanges();
      expect(identifyIsUnavailable(identifySomeoneElse(fixture))).toBe(true);

      paramMap.next(convertToParamMap({ claGroupId: ELSEWHERE_GROUP_ID }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Cascade CLA');
      expect(identifyIsUnavailable(identifySomeoneElse(fixture))).toBe(true);
      expect(byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.disabled).toBe(true);
    });

    /**
     * A switch away from an organization that *did* hold this group, which is the ordering the
     * organization stream cannot answer on its own.
     *
     * While the row is in hand there is no preview to leave, so the switch itself is not the moment
     * the choice becomes wrong — the moment is later, when the new organization's list arrives
     * without the group and the selection is all that is left to render. The organization has
     * already emitted by then and does not emit again, so a guard driven by that stream spends its
     * one chance while the answer is still "nothing to do" and the stale choice renders under a
     * company it was never made for.
     *
     * Reachable whenever a selection outlives a signature for the same group: the signatory signs,
     * the row appears, the choice is still in the history entry, and they switch company.
     */
    it('leaves for the list when the group it held disappears with the organization switch', async () => {
      // Held open rather than answered with `of`, because the ordering *is* the case: upstream is
      // asked when the organization changes and answers afterwards. A synchronous list arrives
      // before the guard reads it and hides the window this test is about.
      const groups = new Subject<OrgClaGroupList>();
      getClaGroups.mockReturnValue(groups);

      const signedHere = { orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ claGroupId: PREVIEW_GROUP_ID, claGroupName: 'Cascade CLA' })] };
      const fixture = await render(previewing());
      groups.next(signedHere);
      fixture.detectChanges();
      await fixture.whenStable();

      // The agreement won, so nothing is previewing and the switch below has nothing to redirect.
      expect(byTestId(fixture, 'org-easycla-detail-status')?.textContent).toContain('Signed');
      expect(navigate).not.toHaveBeenCalled();

      selectedAccount.set(OTHER_ORG);
      fixture.detectChanges();
      await fixture.whenStable();

      // Only now does the new organization's list land, without the group. The selection is all
      // that is left to render, and the organization has already emitted.
      groups.next({ orgUid: '0014100000OtherOrgAA', claGroups: [] });
      fixture.detectChanges();
      await fixture.whenStable();

      // The list of the organization now selected: the address follows the selection (spec 050 US2).
      expect(navigate).toHaveBeenCalledWith(['/org', OTHER_ORG.uid, 'easycla'], { replaceUrl: true });
      // The router is a spy, so this component is still mounted and the preview it should not be
      // showing is still on screen. Start is the assertion that means something in that window:
      // whatever the page renders before the navigation lands, it cannot open a session for the
      // company the choice was never made for.
      expect(byTestId(fixture, 'org-easycla-detail-start-cla')?.querySelector('button')?.disabled).toBe(true);
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
      await render(previewing({ orgUid: OTHER_ORG.uid }));

      // The selection is still Acme; only the stale choice named Other — so the list is Acme's.
      expect(navigate).toHaveBeenCalledWith(['/org', SELECTED_ACCOUNT.uid, 'easycla'], { replaceUrl: true });
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
      selectedAccount.set(OTHER_ORG);
      const component = fixture.componentInstance as unknown as { startClaProcess: () => void };
      component.startClaProcess();

      expect(opened).toEqual([]);
    });
  });

  /**
   * Angular reuses this component as the route parameters change, and since #2364 the preview and
   * the agreement share `/org/easycla/:claGroupId`. When a signatory moves from the preview onto
   * the agreement they just signed, the previous route's `history.state` is still what
   * `Location.getState()` returns until Angular has written the new entry — so the constructor of
   * the reused instance can read a picker choice that has nothing to do with the address it is
   * being reused under.
   *
   * The presence of a `signatureId` parameter used to disqualify that fallback. It no longer
   * exists, so two gates carry it instead: the selection must name the addressed group, and a row
   * in the list outranks it. These cases pin both.
   */
  describe('a stale history entry from a previous preview visit', () => {
    const CASCADE: OrgClaSignSelection = {
      claGroupId: GROUP_ID,
      claGroupName: 'Cascade CLA',
      projectSfid: 'a09410000182dD2AAI',
      projectName: 'Cascade',
      orgUid: SELECTED_ACCOUNT.uid,
    };

    // Same group as the address, so the group gate passes and only the list can stop it. It does:
    // the signed row wins, and the page renders the agreement rather than the stale preview.
    it('does not drive the preview when the list holds an agreement for that group', async () => {
      const fixture = await render(undefined, { [ORG_CLA_SIGN_SELECTION_STATE]: CASCADE });

      expect(getClaGroups).toHaveBeenCalled();
      expect(byTestId(fixture, 'org-easycla-detail-status')?.textContent).toContain('Signed');
      expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Nimbus Foundation CLA');
      const component = fixture.componentInstance as unknown as { showingPreview: () => boolean };
      expect(component.showingPreview()).toBe(false);
    });

    // The other gate, in isolation: a selection for an unrelated group is refused outright, with no
    // list row involved. Asserted through `previewSelection` because refusal happens at read time.
    it('does not read a selection that names a group the address does not', async () => {
      const fixture = await render(undefined, {
        [ORG_CLA_SIGN_SELECTION_STATE]: { ...CASCADE, claGroupId: ELSEWHERE_GROUP_ID },
      });

      const component = fixture.componentInstance as unknown as { previewSelection: OrgClaSignSelection | null };
      expect(component.previewSelection).toBeNull();
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

    it('does not open a hand-off when a leftover ACS close follows Cancel', async () => {
      await start();

      opened[0].onClose.next(null);
      opened[0].onClose.next(attestations);
      opened[0].onDestroy.next();

      expect(opened).toHaveLength(1);
    });

    // Nothing has been created at this point, and the confirmations are about a specific
    // organization's authority and export position — they cannot carry over to another company.
    it('closes the attestation on an organization switch, since no signature has been asked for yet', async () => {
      const fixture = await start();
      expect(opened).toHaveLength(1);

      selectedAccount.set(OTHER_ORG);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(opened[0].close).toHaveBeenCalled();
    });

    // Angular reuses this component when only the route parameters change, so an org-only stream
    // never fires and the attestation would survive onto an agreement it was never about —
    // confirming it then opens a session for the one the viewer navigated away from. Driven through
    // the query, which is the move between two signing entities' agreements inside one CLA Group:
    // the group id does not change, so watching only the path would miss it.
    it('closes the attestation when the viewer moves to another agreement', async () => {
      const fixture = await start();
      expect(opened).toHaveLength(1);

      queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-2' }));
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

      selectedAccount.set(OTHER_ORG);
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

    it('explains that the managers tab is waiting on the signature', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-tab-managers')?.click();
      fixture.detectChanges();

      expect(byTestId(fixture, 'org-easycla-managers-unsigned')?.textContent).toContain(ORG_CLA_MANAGERS_COPY.unsignedTitle);
      expect(byTestId(fixture, 'org-easycla-detail-tab-locked')).toBeNull();
    });

    it('explains that the approval tab is waiting on the signature', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-tab-approval')?.click();
      fixture.detectChanges();

      expect(byTestId(fixture, 'org-easycla-detail-tab-locked')?.textContent).toContain(ORG_CLA_LOCKED_TAB_COPY.approval?.title);
    });

    it('explains that the acknowledgments tab is waiting on the signature', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-tab-acknowledgments')?.click();
      fixture.detectChanges();

      expect(byTestId(fixture, 'org-easycla-detail-tab-locked')?.textContent).toContain(ORG_CLA_LOCKED_TAB_COPY.acknowledgments?.title);
    });

    it('explains that the activity tab is waiting on the signature', async () => {
      getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(notStarted)] }));

      const fixture = await render();
      byTestId(fixture, 'org-easycla-detail-tab-activity')?.click();
      fixture.detectChanges();

      expect(byTestId(fixture, 'org-easycla-detail-tab-locked')?.textContent).toContain(ORG_CLA_LOCKED_TAB_COPY.activity?.title);
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

  it('opens Overview by default and fills the Managers tab, leaving the rest empty', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-overview')).toBeTruthy();

    byTestId(fixture, 'org-easycla-detail-tab-managers')?.click();
    fixture.detectChanges();

    expect(byTestId(fixture, 'org-easycla-detail-overview')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-managers')).toBeTruthy();
    expect(getPdfUrl).not.toHaveBeenCalled();
  });

  it('fills the Contributor Acknowledgments tab', async () => {
    const fixture = await render();

    byTestId(fixture, 'org-easycla-detail-tab-acknowledgments')?.click();
    fixture.detectChanges();

    expect(byTestId(fixture, 'org-easycla-detail-acknowledgments')).toBeTruthy();
  });

  it('opens the Approval List tab from a Not Authorized acknowledgment', async () => {
    // The add-to-list remedy link renders only when the tab resolves the `approval-list-update`
    // grant, which needs a mapped project SFID to query ACS. The bare fixture carries none, so pin
    // one here; checkPermission already answers true in this block.
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ pairProjectSfid: 'project-sfid-1' })] }));
    getContributorAcknowledgments.mockReturnValue(
      of({
        signatureId: 'signature-uuid-1',
        list: [{ signatureId: 'ecla-1', approved: false, removedFromApprovalList: true }],
        canEdit: true,
        resultCount: 1,
        totalCount: 1,
        nextKey: null,
      })
    );
    const fixture = await render();

    byTestId(fixture, 'org-easycla-detail-tab-acknowledgments')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    byTestId(fixture, 'org-easycla-acknowledgment-add-to-approval-list')?.click();
    fixture.detectChanges();

    expect(byTestId(fixture, 'org-easycla-approval-list')).toBeTruthy();
    expect(byTestId(fixture, 'org-easycla-detail-acknowledgments')).toBeNull();
  });

  it('renders the Activity Log panel on a signed agreement when the Activity Log tab is selected', async () => {
    const fixture = await render();

    byTestId(fixture, 'org-easycla-detail-tab-activity')?.click();
    fixture.detectChanges();

    // The Activity Log tab body wires the OrgEasyclaActivityLogComponent (#1987), so the panel
    // renders instead of falling to the bare-tab empty state that used to occupy this branch.
    expect(byTestId(fixture, 'org-easycla-detail-activity')).toBeTruthy();
    expect(byTestId(fixture, 'org-easycla-detail-tab-empty')).toBeNull();
  });

  it('fetches no roster on first paint', async () => {
    await render();

    expect(getManagers).not.toHaveBeenCalled();
  });

  it('shows the manager, approval, and acknowledgment counts on the tab bar', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-managers')?.textContent?.trim()).toBe('2');
    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-approval')?.textContent?.trim()).toBe('7');
    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-acknowledgments')?.textContent?.trim()).toBe('4');
  });

  it('counts acknowledgments with a one-row read of the displayed agreement', async () => {
    await render();

    expect(getContributorAcknowledgments).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1', { pageSize: 1 });
  });

  it('reads no acknowledgment count for an unsigned agreement, which holds none', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ signed: false, status: 'not-started', signedOn: undefined })] }));
    const fixture = await render();

    expect(getContributorAcknowledgments).not.toHaveBeenCalled();
    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-acknowledgments')).toBeNull();
  });

  it('leaves the acknowledgment badge empty when the count read fails', async () => {
    getContributorAcknowledgments.mockReturnValue(throwError(() => new Error('boom')));
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-acknowledgments')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-detail-overview')).toBeTruthy();
  });

  // The detail page is reused across agreement changes, so a panel count captured for one
  // agreement must not shadow a fresh page-load count when the same agreement is reopened.
  it('drops a stale panel count when the agreement changes, so the reopened badge reads fresh', async () => {
    getClaGroups.mockReturnValue(
      of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup(), claGroup({ id: 'signature-uuid-2', claGroupName: 'Other CLA' })] })
    );
    getContributorAcknowledgments.mockImplementation((_orgUid: string, signatureId: string) =>
      of({ signatureId, list: [], canEdit: true, resultCount: 0, totalCount: signatureId === 'signature-uuid-1' ? 5 : 3, nextKey: null })
    );

    const fixture = await render();
    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-acknowledgments')?.textContent?.trim()).toBe('5');

    // The open panel reports a different count for the agreement on screen.
    (
      fixture.componentInstance as unknown as { onAcknowledgmentCountChanged(event: { signatureId: string; count: number }): void }
    ).onAcknowledgmentCountChanged({
      signatureId: 'signature-uuid-1',
      count: 9,
    });
    fixture.detectChanges();
    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-acknowledgments')?.textContent?.trim()).toBe('9');

    // Leave for another agreement and come back to the same one.
    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-2' }));
    fixture.detectChanges();
    await fixture.whenStable();
    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-1' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The stale panel count is gone; the badge reflects the fresh one-row read.
    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-acknowledgments')?.textContent?.trim()).toBe('5');
  });

  // The panel measures its approval count against a specific agreement; the parent must file it
  // under that agreement, not whichever one it has since switched to on a reused route.
  it('files a panel approval count under the agreement it was measured for, not the current one', async () => {
    getClaGroups.mockReturnValue(
      of({
        orgUid: SELECTED_ACCOUNT.uid,
        claGroups: [claGroup(), claGroup({ id: 'signature-uuid-2', claGroupName: 'Other CLA', approvalCriteriaCount: 2 })],
      })
    );
    const fixture = await render();

    // A count arrives for the first agreement after the page has moved to the second.
    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-2' }));
    fixture.detectChanges();
    await fixture.whenStable();
    (fixture.componentInstance as unknown as { onPanelApprovalCountChanged(event: { signatureId: string; count: number }): void }).onPanelApprovalCountChanged({
      signatureId: 'signature-uuid-1',
      count: 99,
    });
    fixture.detectChanges();

    // The second agreement keeps its own row count; the stale count does not leak in.
    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-approval')?.textContent?.trim()).toBe('2');
  });

  // The badge keys on the displayed agreement, not the raw sig query param: when the param is
  // stale or absent the agreement still resolves by group, and a panel count for it must apply.
  it('applies a panel approval count for the displayed agreement even when the sig param is stale', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ id: 'other-signature' })] }));
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-approval')?.textContent?.trim()).toBe('7');

    (fixture.componentInstance as unknown as { onPanelApprovalCountChanged(event: { signatureId: string; count: number }): void }).onPanelApprovalCountChanged({
      signatureId: 'other-signature',
      count: 3,
    });
    fixture.detectChanges();

    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-approval')?.textContent?.trim()).toBe('3');
  });

  /**
   * A copied link outlives the list it was copied from, so a signature it names can be gone — the
   * row superseded, or the link shared by someone whose list differs. The group id is the
   * authoritative half of the address, so the group's current agreement is the answer; an empty
   * page would be strictly less useful and would read as though the organization holds nothing.
   */
  it('falls back to the group when the named signature is no longer in the list', async () => {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup({ id: 'other-signature' })] }));

    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-not-found-state')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-detail-overview')).toBeTruthy();
  });

  /**
   * An address naming a CLA Group the organization holds nothing for. This is what the list
   * loading without the row now means, and it is deliberately *not* "not found": the group may
   * well exist and be signable. What is absent is anything this page can say about it, since the
   * list read returns signed agreements only and there is no fetch-a-group-by-id read.
   */
  it('cannot preview a CLA Group the organization holds nothing for', async () => {
    paramMap.next(convertToParamMap({ claGroupId: UNHELD_GROUP_ID }));
    queryParamMap.next(convertToParamMap({}));

    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).toBeTruthy();
    expect(byTestId(fixture, 'org-easycla-detail-not-found-state')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-detail-overview')).toBeNull();
    // Stays on the address. Redirecting to the list would contradict the named signing overview
    // that will claim this address.
    expect(navigate).not.toHaveBeenCalled();
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
    expect(byTestId(fixture, 'org-easycla-detail-review-copy')).toBeNull();

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

    selectedAccount.set(OTHER_ORG);
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

    // Angular reuses this component when only the route parameters change, so the organization
    // never changes and an org-only cancellation stream would not fire. The two rows share a CLA
    // Group — two signing entities — so only the query moves, which is why the cancellation stream
    // has to watch it and not just the path.
    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-2' }));
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

    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-2' }));
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

  /**
   * The signatory comes back from DocuSign to this agreement's own address (#2352).
   *
   * It can be named in `return_url` even though the signature cannot, because the page is addressed
   * by CLA Group and the group is chosen before the signing request is opened (#2364). What the
   * address cannot promise is that the row is listed yet — EasyCLA writes the signature when
   * DocuSign calls it back, and that callback races the return trip. So the address carries a flag,
   * and the flag buys a wait: while it is live and nothing resolves, the page keeps asking rather
   * than settling on "this organization has signed nothing here".
   *
   * These cases are the ones the list page used to own, re-expressed against the group address.
   */
  describe('when EasyCLA returns the signatory after a corporate signing', () => {
    const NAMED = { uid: '0014100000Te0OKAAZ', accountId: '0014100000Te0OKAAZ', accountName: 'Microsoft Corporation' };
    const ELSEWHERE = { uid: '0014100000Te2QjAAJ', accountId: '0014100000Te2QjAAJ', accountName: 'ContainerShip, Inc.' };

    /** The shape the catalogue and the account context agree on, as far as these cases need it. */
    interface Held {
      uid: string;
      accountId?: string | null;
      accountName: string;
    }

    /**
     * Both parameters off, in place of the entry they were on.
     *
     * Asserted as a whole rather than by `objectContaining`, because `replaceUrl` is the half that
     * matters most: an entry left behind is one Back re-enters, spending the wait again.
     */
    const STRIPPED_ADDRESS = {
      relativeTo: expect.anything(),
      queryParams: { org: null, signed: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    };

    function catalogueItem(account: Held): OrgItem {
      return { uid: account.uid, accountId: account.accountId ?? account.uid, name: account.accountName, logoUrl: null };
    }

    async function renderReturn(
      options: {
        org?: string | null;
        flag?: string | null;
        claGroups?: OrgClaGroup[];
        listOrgUid?: string;
        held?: Held[];
        heldAfterReload?: Held[];
        previewState?: Record<string, unknown>;
        catalogueLoadsLater?: boolean;
        /**
         * A list per organization, for the cases where who is asking is the point.
         *
         * `'never'` is an organization whose request neither answers nor fails, which is how a case
         * holds the wait open long enough for something else to happen first.
         */
        claGroupsByOrg?: Record<string, OrgClaGroup[] | 'never'>;
        /**
         * Holds adoption open without holding the rest of the page open with it.
         *
         * `catalogueLoadsLater` stalls the catalogue, which also stalls the org context the whole
         * page waits on — so nothing downstream of adoption can be observed. This instead lets the
         * catalogue load *without* the named organization, so adoption reaches its second pass and
         * waits there while the page carries on. The case lands it by calling `landAdoption`.
         */
        adoptionLandsLater?: Held[];
        /** Render under `/org/{orgSegment}/easycla/…` instead of the legacy mount. */
        orgSegment?: string;
      } = {}
    ) {
      orgSegment = options.orgSegment ?? null;
      const {
        org = NAMED.uid,
        flag = '1',
        claGroups = [claGroup()],
        listOrgUid = NAMED.uid,
        held = [NAMED],
        heldAfterReload,
        previewState,
        catalogueLoadsLater = false,
        claGroupsByOrg,
        adoptionLandsLater,
      } = options;

      selectedAccount.set(SELECTED_ACCOUNT);
      // Adoption cannot resolve until the catalogue has loaded, which is how a case pushes it past
      // the first settled list instead of taking the two in whichever order the harness happens to
      // produce. Flipped back by the case itself.
      navLoaded.set(!catalogueLoadsLater);
      if (claGroupsByOrg) {
        getClaGroups.mockImplementation((uid: string) => {
          const listed = claGroupsByOrg[uid];
          if (listed === 'never') return new Subject();
          return of({ orgUid: uid, claGroups: listed ?? [] });
        });
      } else {
        getClaGroups.mockReturnValue(of({ orgUid: listOrgUid, claGroups }));
      }

      const query: Record<string, string> = {};
      if (org) query[ORG_EASYCLA_RETURN_ORG_PARAM] = org;
      if (flag) query[ORG_EASYCLA_RETURN_SIGNED_PARAM] = flag;
      paramMap.next(convertToParamMap({ claGroupId: GROUP_ID }));
      // No `sig` on a return address: the signature does not exist when `return_url` is fixed. The
      // group id plus the organization is the whole of what the trip carries.
      queryParamMap.next(convertToParamMap(query));

      const items = signal(held.map(catalogueItem));
      // Left unanswered when the case wants to observe the page mid-adoption; `landAdoption` is
      // what answers it.
      const resetAndReload = vi.fn(() => {
        if (adoptionLandsLater) return;
        items.set((heldAfterReload ?? held).map(catalogueItem));
      });
      const landAdoption = () => items.set((adoptionLandsLater ?? held).map(catalogueItem));

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [OrgEasyclaDetailComponent],
        providers: [
          provideRouter([]),
          provideNoopAnimations(),
          {
            provide: ActivatedRoute,
            useValue: { paramMap, queryParamMap, snapshot: { paramMap: paramMap.value, queryParamMap: queryParamMap.value, pathFromRoot: mountPath() } },
          },
          {
            provide: AccountContextService,
            // Adoption really moves the selection, as it does in the browser. A stub that records
            // the call and changes nothing leaves the page fetching for the organization being
            // left, and every ordering that depends on the selection catching up goes untested.
            useValue: {
              selectedAccount,
              selectedUrlSegment,
              hasOrgSelectorAccess,
              setAccount: (account: { uid?: string; accountName: string }) => selectedAccount.set(account),
              adoptFromAddress: (account: { uid?: string; accountName: string }) => selectedAccount.set(account),
              refreshCanonicalRecord: vi.fn().mockResolvedValue(undefined),
            },
          },
          { provide: OrgRoleGrantsService, useValue: { loaded: grantsLoaded, correlationId } },
          { provide: PersonaService, useValue: { personaLoaded } },
          { provide: OrgNavigationService, useValue: { items, loaded: navLoaded, resetAndReload } },
          { provide: OrgLensEmptyStateService, useValue: emptyStateService },
          {
            provide: OrgLensClaService,
            useValue: { getClaGroups, getPdfUrl, getApprovalList, updateApprovalList, checkPermission, getContributorAcknowledgments },
          },
          { provide: MessageService, useValue: { add: addMessage } },
          ConfirmationService,
        ],
      }).compileComponents();

      TestBed.overrideComponent(OrgEasyclaDetailComponent, {
        set: {
          providers: [
            {
              provide: DialogService,
              useValue: { open: openDialog, dialogComponentRefMap: { get: () => ({ setInput: setDialogPt, changeDetectorRef: { detectChanges: vi.fn() } }) } },
            },
          ],
        },
      });

      const router = TestBed.inject(Router);
      navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      vi.spyOn(router, 'getCurrentNavigation').mockReturnValue(
        previewState === undefined ? null : ({ extras: { state: previewState } } as unknown as Navigation)
      );
      vi.spyOn(TestBed.inject(Location), 'getState').mockReturnValue({});

      const fixture = TestBed.createComponent(OrgEasyclaDetailComponent);
      await flush(fixture);
      await flush(fixture);

      return { fixture, resetAndReload, landAdoption };
    }

    async function flush(fixture: ComponentFixture<OrgEasyclaDetailComponent>): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('selects the organization the signature was made for, not whichever one the cookie lost', async () => {
      await renderReturn();

      expect(selectedAccount()?.uid).toBe(NAMED.uid);
    });

    // Spec 050 phase 2: under `/org/{segment}/easycla/…` the path names the organization and the
    // path guard is its authority (it adopted the selection before activation). A `?org=` there —
    // carried over by a switch off a legacy return, or crafted — must not override it: the selection
    // stays what the guard adopted, the wait runs against *that* organization's list and settles on
    // it, and both parameters come off the address.
    it('ignores ?org= on the organization-addressed mount and settles the wait on the addressed organization', async () => {
      const { fixture } = await renderReturn({ orgSegment: 'acme', listOrgUid: SELECTED_ACCOUNT.uid });

      expect(selectedAccount()?.uid).toBe(SELECTED_ACCOUNT.uid);
      expect(getClaGroups).not.toHaveBeenCalledWith(NAMED.uid);
      expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Nimbus Foundation CLA');
      expect(byTestId(fixture, 'org-easycla-detail-confirming-signature')).toBeNull();
      expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
    });

    // The address the BFF mints once the `ORG_EASYCLA_RETURN_IN_PATH` gate is on: the organization
    // in the path, the flag alone in the query. The wait is keyed to the addressed organization
    // and the flag is stripped once the row is in hand.
    it('follows a gated return — organization in the path, no ?org= — to the signed agreement', async () => {
      const { fixture } = await renderReturn({ orgSegment: 'acme', org: null, listOrgUid: SELECTED_ACCOUNT.uid });

      expect(selectedAccount()?.uid).toBe(SELECTED_ACCOUNT.uid);
      expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Nimbus Foundation CLA');
      expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
    });

    // A gated return whose row has not landed yet still waits — on the addressed organization's
    // list, not on whichever one answers — and a switch mid-wait ends the trip instead of taking
    // the new organization's list as the answer.
    it('ends a gated return’s wait when the viewer switches organization instead of resuming it under the new one', async () => {
      vi.useFakeTimers();
      try {
        const { fixture } = await renderReturn({
          orgSegment: 'acme',
          org: null,
          claGroupsByOrg: { [SELECTED_ACCOUNT.uid]: [], [ELSEWHERE.uid]: [claGroup()] },
        });
        expect(byTestId(fixture, 'org-easycla-detail-confirming-signature')?.textContent?.trim()).toBe(CCLA_SIGN_COPY.returnWait);

        selectedAccount.set(ELSEWHERE);
        await flush(fixture);
        await vi.advanceTimersByTimeAsync(2000);
        await flush(fixture);

        expect(byTestId(fixture, 'org-easycla-detail-confirming-signature')).toBeNull();
        expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
      } finally {
        vi.useRealTimers();
      }
    });

    // A stale `?org=` on the addressed mount with no wait open is not adopted — but it is not left
    // on the address either, where a reload or a copied link would keep presenting it.
    it('strips a stale ?org= from the organization-addressed address even with no wait open', async () => {
      await renderReturn({ orgSegment: 'acme', flag: null, listOrgUid: SELECTED_ACCOUNT.uid });

      expect(selectedAccount()?.uid).toBe(SELECTED_ACCOUNT.uid);
      expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
    });

    /**
     * A viewer who reaches an organization through a role grant rather than through a membership
     * can have it missing from the catalogue page in hand. Pinning the reload to the name and
     * looking again is what turns that into a selection instead of a miss.
     */
    it('asks the catalogue for an organization it does not yet list, then selects it', async () => {
      const { resetAndReload } = await renderReturn({ held: [ELSEWHERE], heldAfterReload: [ELSEWHERE, NAMED] });

      expect(resetAndReload).toHaveBeenCalledWith(NAMED.uid);
      expect(selectedAccount()?.uid).toBe(NAMED.uid);
    });

    /**
     * After the signed-row wait moved behind adoption, a pin reload that never answers left adopt()
     * pending, so settleReturn never ran and the return parameters stayed on the address. The reload
     * is bounded: a miss settles the same way a catalogue refusal does.
     */
    it('settles when the catalogue pin reload never answers', async () => {
      vi.useFakeTimers();
      try {
        const { fixture, resetAndReload } = await renderReturn({ held: [ELSEWHERE], adoptionLandsLater: [NAMED] });

        expect(resetAndReload).toHaveBeenCalledWith(NAMED.uid);
        expect(selectedAccount()?.uid).toBe(SELECTED_ACCOUNT.uid);

        await vi.advanceTimersByTimeAsync(10_000);
        await flush(fixture);

        expect(selectedAccount()?.uid).toBe(SELECTED_ACCOUNT.uid);
        expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * `uid` and `accountId` are the same Salesforce id in principle, but `accountId` is nullable on
     * pre-spec-002 catalogue rows, so adoption matches on either — and the return address may
     * therefore name either. Everything downstream instead compares the address against the list's
     * own `orgUid`, which agrees only because adoption pins the named value onto the selection it
     * makes.
     *
     * Exercised with the two spellings apart, because while they are equal that comparison holds
     * whether the pinning is there or not: a selection keyed on the row's `uid` would leave the
     * named organization's own list looking like another company's for the rest of the trip.
     */
    it('resolves a return that names the organization by its account id rather than its uid', async () => {
      const BY_ACCOUNT_ID = { uid: '0014100000Te7RmAAB', accountId: '0014100000Te8SnAAC', accountName: 'Nimbus Holdings' };

      const { fixture } = await renderReturn({
        org: BY_ACCOUNT_ID.accountId,
        held: [BY_ACCOUNT_ID],
        claGroupsByOrg: { [BY_ACCOUNT_ID.accountId]: [claGroup()] },
      });

      // The agreement first, because it is the consequence: a selection keyed on the wrong spelling
      // reads as a bare uid mismatch, while what the signatory actually gets is the cannot-preview
      // state over an agreement they hold.
      expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Nimbus Foundation CLA');
      expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).toBeNull();
      expect(selectedAccount()?.uid).toBe(BY_ACCOUNT_ID.accountId);
      expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
    });

    /**
     * Naming is not granting. A hand-crafted address selects nothing, and the wait it opened ends
     * rather than hanging: no list is ever fetched for an organization the viewer does not hold, so
     * a wait on one would never see an answer.
     */
    it('neither selects nor renders an organization the viewer does not hold', async () => {
      const { fixture } = await renderReturn({ org: 'not-an-organization-they-hold', listOrgUid: SELECTED_ACCOUNT.uid, claGroups: [] });

      expect(selectedAccount()?.uid).toBe(SELECTED_ACCOUNT.uid);
      expect(byTestId(fixture, 'org-easycla-detail-title')).toBeNull();
      expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
    });

    /**
     * A miss on the named organization closes the trip. The list that then arrives belongs to
     * whichever organization is still selected — so treating it as the wait's answer would spend a
     * budget on a company nobody asked about.
     *
     * Counted in fetches rather than in what is on screen, because such a wait is invisible: the
     * flag is already down, so the skeleton the confirming line lives in never renders.
     */
    it('does not reopen the wait on a list that settles after the trip is already over', async () => {
      vi.useFakeTimers();
      try {
        const { fixture } = await renderReturn({ org: 'not-an-organization-they-hold', listOrgUid: SELECTED_ACCOUNT.uid, claGroups: [] });
        const fetchesBeforeTheBudget = getClaGroups.mock.calls.length;

        await vi.advanceTimersByTimeAsync(30_000);
        await flush(fixture);

        expect(getClaGroups.mock.calls.length).toBe(fetchesBeforeTheBudget);
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * The ordinary case once EasyCLA has caught up: the row is already listed, so there is nothing
     * to wait for and the page renders it straight away.
     *
     * The address is still cleaned up. Left in place the flag would reopen the wait on every reload
     * of a copied link, and `?org=` would pin an organization that contradicts the viewer the
     * moment they switch.
     */
    it('renders the agreement when the first list already carries it, and clears the return address', async () => {
      const { fixture } = await renderReturn();

      expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Nimbus Foundation CLA');
      expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
    });

    /**
     * A signatory who has just finished a DocuSign ceremony and is shown nothing but grey bars
     * reaches for reload — which restarts the wait rather than shortening it. The line is what
     * makes the wait legible.
     */
    it('holds the skeleton and says what it is waiting for when the row is not listed yet', async () => {
      const { fixture } = await renderReturn({ claGroups: [] });

      expect(byTestId(fixture, 'org-easycla-detail-list-loading')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-confirming-signature')?.textContent?.trim()).toBe(CCLA_SIGN_COPY.returnWait);
      expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).toBeNull();
    });

    /**
     * Before the first settled list the wait is indistinguishable from an ordinary fetch, and
     * "confirming your signature" over a list that is merely still in flight explains the wrong
     * thing.
     */
    it('says nothing about confirming until the first list has settled', async () => {
      // Never fed, so the page's own fetch is still outstanding when the assertion runs. Queued as
      // a one-shot because the harness installs the default response after this line.
      getClaGroups.mockReturnValueOnce(new Subject());
      const { fixture } = await renderReturn({ claGroups: [] });

      expect(byTestId(fixture, 'org-easycla-detail-list-loading')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-confirming-signature')).toBeNull();
    });

    // The first answer without the row is "too early", not "no" — so the callback landing between
    // the first list and a retry is the case the whole flag exists for.
    it('renders the agreement when it arrives on a retry', async () => {
      vi.useFakeTimers();
      try {
        const { fixture } = await renderReturn({ claGroups: [] });
        expect(byTestId(fixture, 'org-easycla-detail-title')).toBeNull();

        getClaGroups.mockReturnValue(of({ orgUid: NAMED.uid, claGroups: [claGroup()] }));
        await vi.advanceTimersByTimeAsync(2000);
        await flush(fixture);

        expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Nimbus Foundation CLA');
        expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * A failed request answers nothing about the row, but it does answer whether to keep waiting.
     * The page fetches once per organization, so nothing is coming to replace the failure — and a
     * wait on the list it did not return would never end.
     */
    it('asks again rather than waiting for ever when the list request fails', async () => {
      vi.useFakeTimers();
      try {
        getClaGroups.mockReturnValueOnce(throwError(() => new Error('upstream')));
        const { fixture } = await renderReturn();

        await vi.advanceTimersByTimeAsync(2000);
        await flush(fixture);

        expect(byTestId(fixture, 'org-easycla-detail-title')?.textContent).toContain('Nimbus Foundation CLA');
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * The same failure, read on screen. Because a retry can still produce the row — and one that
     * does clears the error — the failure the signatory would be shown was never terminal, and
     * showing it anyway contradicts the retries running behind it.
     */
    it('holds the confirming skeleton over a failed list request rather than calling it an error', async () => {
      getClaGroups.mockReturnValueOnce(throwError(() => new Error('upstream')));
      const { fixture } = await renderReturn({ claGroups: [] });

      expect(byTestId(fixture, 'org-easycla-detail-error-state')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-list-loading')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-confirming-signature')?.textContent?.trim()).toBe(CCLA_SIGN_COPY.returnWait);
    });

    /**
     * Outranked, not suppressed. Once the wait is spent there is nothing left to contradict, and a
     * failure that outlived the whole budget is the honest answer — the signatory should be told
     * the page could not load rather than shown an empty state that reads as "nothing here".
     */
    it('shows the failure once the wait that outranked it has been spent', async () => {
      vi.useFakeTimers();
      try {
        getClaGroups.mockReturnValueOnce(throwError(() => new Error('upstream')));
        const { fixture } = await renderReturn({ claGroups: [] });
        // Every retry fails too, so nothing ever arrives to clear the error the first fetch set.
        getClaGroups.mockReturnValue(throwError(() => new Error('upstream')));
        expect(byTestId(fixture, 'org-easycla-detail-error-state')).toBeNull();

        await vi.advanceTimersByTimeAsync(30_000);
        await flush(fixture);

        expect(byTestId(fixture, 'org-easycla-detail-error-state')).not.toBeNull();
        expect(byTestId(fixture, 'org-easycla-detail-confirming-signature')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * A retry that succeeds without the row is still an answer about the list, and it is the one
     * the page will show once the budget is spent. Without keeping it, an initial failure followed
     * by a recovery leaves the error state up over a list now in hand — and the signatory is told
     * the page broke rather than that their agreement is not listed yet.
     */
    it('keeps a list a retry recovered when the row is still missing at the end', async () => {
      vi.useFakeTimers();
      try {
        getClaGroups.mockReturnValueOnce(throwError(() => new Error('upstream')));
        getClaGroups.mockReturnValue(of({ orgUid: NAMED.uid, claGroups: [] }));
        const { fixture } = await renderReturn({ claGroups: [] });

        await vi.advanceTimersByTimeAsync(30_000);
        await flush(fixture);

        expect(byTestId(fixture, 'org-easycla-detail-error-state')).toBeNull();
        expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * Bounded, because past a few seconds the likelier explanations are ones no amount of waiting
     * fixes. What the exhausted wait must not do is leave the address: this is the address the
     * agreement will have once EasyCLA catches up, so a reload is all it takes — where the list
     * would be a dead end wearing a different URL.
     */
    it('settles on this address, not the list, when the wait is spent', async () => {
      vi.useFakeTimers();
      try {
        const { fixture } = await renderReturn({ claGroups: [] });

        await vi.advanceTimersByTimeAsync(30_000);
        await flush(fixture);

        expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).not.toBeNull();
        expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
        expect(navigate).not.toHaveBeenCalledWith(['/org', SELECTED_ACCOUNT.uid, 'easycla'], expect.anything());
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * This page survives an organization switch, so a wait left running would answer for a company
     * the viewer has deliberately left — and render that company's agreement under the name of the
     * one now selected.
     */
    it('gives up when the viewer selects another organization while it is still waiting', async () => {
      vi.useFakeTimers();
      try {
        const { fixture } = await renderReturn({ claGroups: [] });

        selectedAccount.set(ELSEWHERE);
        await flush(fixture);

        // The callback lands, but for the organization no longer being looked at.
        getClaGroups.mockReturnValue(of({ orgUid: NAMED.uid, claGroups: [claGroup()] }));
        await vi.advanceTimersByTimeAsync(30_000);
        await flush(fixture);

        expect(byTestId(fixture, 'org-easycla-detail-title')).toBeNull();
        expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * The budget is count-bounded, but each attempt talks to the BFF and the BFF's own gateway
     * timeout is 30 seconds. `concatMap` runs the attempts in series, so a stalled BFF would leave
     * three attempts waiting the full 30 seconds each — about 90 seconds against a doc comment that
     * describes a few-second budget. The per-attempt `timeout()` bounds the wait in wall-clock time
     * as well as in count.
     *
     * A request that neither errors nor completes is what the fixture models: a Subject that is
     * never fed. Without the timeout `concatMap` waits for it for ever, and even a 30-second
     * advance cannot spend the budget.
     */
    it('bounds the wait in wall-clock time when each attempt hangs, not only in count', async () => {
      vi.useFakeTimers();
      try {
        // One retry-delay plus one per-attempt timeout is (2000 + 3000)ms; three attempts is
        // 15_000ms. Sized a beat past that, so a regression off by one attempt still fails.
        const budgetMs = 3 * (2000 + 3000);
        const { fixture } = await renderReturn({ claGroups: [] });
        getClaGroups.mockReturnValue(new Subject());

        await vi.advanceTimersByTimeAsync(budgetMs + 1000);
        await flush(fixture);

        expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).not.toBeNull();
        expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * The wait is about the named organization's list, and that list is not fetched until adoption
     * selects it — so the wait has to start from adoption, not alongside it.
     *
     * Started alongside, the restored organization's list settles first, the retries capture that
     * organization, and adoption arriving a moment later reads as the viewer switching company:
     * the retries are torn down and the trip is spent without the organization that was actually
     * signed for ever having been asked. Both halves of that are asserted — the address must still
     * carry its parameters when adoption lands, and the retries that follow must name the adopted
     * organization.
     */
    it('waits against the organization it adopted, not the one the cookie restored', async () => {
      vi.useFakeTimers();
      try {
        const { fixture } = await renderReturn({ catalogueLoadsLater: true, listOrgUid: SELECTED_ACCOUNT.uid, claGroups: [] });

        // Answers from here on belong to the organization about to be adopted.
        getClaGroups.mockReturnValue(of({ orgUid: NAMED.uid, claGroups: [] }));
        navLoaded.set(true);
        await flush(fixture);

        expect(selectedAccount()?.uid).toBe(NAMED.uid);
        expect(navigate).not.toHaveBeenCalledWith([], STRIPPED_ADDRESS);

        // Cleared so only the retries are counted, not the page's own fetch for the new selection.
        getClaGroups.mockClear();
        await vi.advanceTimersByTimeAsync(2000);
        await flush(fixture);

        expect(getClaGroups).toHaveBeenCalledWith(NAMED.uid);
        expect(getClaGroups).not.toHaveBeenCalledWith(SELECTED_ACCOUNT.uid);
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * The page resolves an address against whatever list it holds, and a list cannot say whose it
     * is at the point of matching. So while adoption is in flight the list in hand is still the
     * restored organization's — and one CLA Group carries a row per signing entity, which is the
     * grain #2364 documented with live examples. A restored organization that has itself signed
     * this group therefore resolves, and its signer, date and document go on screen in front of
     * someone who has just signed for a different company.
     *
     * Self-correcting once adoption lands, but the window is however long adoption takes, and what
     * it shows in the meantime is another company's executed agreement.
     */
    it('renders nothing from the restored organization, even when it holds a row at the same group', async () => {
      const { fixture, landAdoption } = await renderReturn({
        held: [ELSEWHERE],
        adoptionLandsLater: [ELSEWHERE, NAMED],
        claGroupsByOrg: {
          [SELECTED_ACCOUNT.uid]: [claGroup({ id: 'signature-uuid-restored', signingEntityName: 'Restored Holdings BV' })],
          [NAMED.uid]: [claGroup({ id: 'signature-uuid-named', signingEntityName: 'Named Holdings BV' })],
        },
      });

      expect(byTestId(fixture, 'org-easycla-detail-title')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-signing-entity')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-list-loading')).not.toBeNull();

      landAdoption();
      await flush(fixture);

      expect(byTestId(fixture, 'org-easycla-detail-signing-entity')?.textContent).toContain('Named Holdings BV');
    });

    /**
     * The other half of the same mistake, on the wait rather than on the render: "settled" meant
     * "a list matching the current selection", not "a list belonging to the organization this
     * return is about". Switch companies before the named one's list answers and the new one's
     * list satisfies the wait, which then spends its budget polling a company that has nothing to
     * do with the signature — and the guard that should have stopped it could not, because it was
     * built from the very selection that had just been captured.
     */
    it('does not take another organization’s list as the answer when the viewer switches mid-wait', async () => {
      vi.useFakeTimers();
      try {
        // The named organization's list never answers, so the switch lands while the wait is still
        // open with nothing of its own to go on.
        const { fixture } = await renderReturn({ claGroupsByOrg: { [NAMED.uid]: 'never', [ELSEWHERE.uid]: [] } });

        selectedAccount.set(ELSEWHERE);
        await flush(fixture);
        // Cleared so only what the wait asks for is counted, not the page's own fetch for the
        // organization the viewer has just moved to.
        getClaGroups.mockClear();

        await vi.advanceTimersByTimeAsync(30_000);
        await flush(fixture);

        expect(byTestId(fixture, 'org-easycla-detail-confirming-signature')).toBeNull();
        expect(getClaGroups).not.toHaveBeenCalledWith(ELSEWHERE.uid);
        expect(navigate).toHaveBeenCalledWith([], STRIPPED_ADDRESS);
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * Whichever organization was selected at boot settles first and cannot hold the new agreement,
     * so a decision taken against that list would spend the wait on a row that was never going to
     * be in it.
     */
    it('waits for the named organization’s own list rather than deciding on the one in hand', async () => {
      const { fixture } = await renderReturn({ listOrgUid: ELSEWHERE.uid });

      expect(byTestId(fixture, 'org-easycla-detail-title')).toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-list-loading')).not.toBeNull();
    });

    /**
     * The flag defers the four-way discriminator; it does not add a fifth outcome. An address
     * without it resolves exactly as it did before — which is what keeps a group address from
     * reading as a signing return every time someone opens one.
     */
    it('opens no wait on an ordinary visit that carries no flag', async () => {
      const { fixture } = await renderReturn({ org: null, flag: null, claGroups: [], listOrgUid: SELECTED_ACCOUNT.uid });

      expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-confirming-signature')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });

    // Pinned to the one value the BFF writes rather than treated as present-or-absent, so a
    // hand-edited parameter cannot open a wait on an address that has nothing to wait for.
    it('ignores a flag value it never writes', async () => {
      const { fixture } = await renderReturn({ org: null, flag: 'maybe', claGroups: [], listOrgUid: SELECTED_ACCOUNT.uid });

      expect(byTestId(fixture, 'org-easycla-detail-cannot-preview-state')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-confirming-signature')).toBeNull();
    });

    /**
     * The wait outranks the picker preview too, and deliberately: telling someone who has just
     * signed that their organization has not signed yet is the worst thing this page could say.
     *
     * A real return cannot reach the preview anyway — DocuSign's return is a cross-document
     * navigation with no picker state to find — so this pins the rule rather than a live path.
     */
    it('holds the wait over a picker selection for the group just signed', async () => {
      const selection: OrgClaSignSelection = {
        claGroupId: GROUP_ID,
        claGroupName: 'Nimbus Foundation CLA',
        projectSfid: 'a09410000182dD2AAI',
        projectName: 'Nimbus Foundation',
        orgUid: NAMED.uid,
      };
      const { fixture } = await renderReturn({ claGroups: [], previewState: { [ORG_CLA_SIGN_SELECTION_STATE]: selection } });

      expect(byTestId(fixture, 'org-easycla-detail-list-loading')).not.toBeNull();
      expect(byTestId(fixture, 'org-easycla-detail-not-started')).toBeNull();
    });
  });
});

/**
 * The approval tab's badge (#1985).
 *
 * The count on the tab is the CLA Group row's `approvalCriteriaCount`, which came from the list
 * fetch and does not move when the tab below writes. So the tab reports its own size after a
 * write, and this is where the two are reconciled.
 */
describe('OrgEasyclaDetailComponent — the approval tab', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000AcmeOrgAAA', accountName: 'Acme' };

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(SELECTED_ACCOUNT);
  const mountPath = (): { paramMap: ReturnType<typeof convertToParamMap> }[] => [{ paramMap: convertToParamMap({}) }, { paramMap: paramMap.value }];
  // Mirrors AccountContextService.selectedUrlSegment: the SFID, since these accounts carry no slug.
  const selectedUrlSegment = computed(() => selectedAccount()?.uid ?? null);
  // Both halves of the address (#2364), as the main describe above supplies them: the CLA Group in
  // the path, the signature narrowing it in the query.
  const paramMap = new BehaviorSubject(convertToParamMap({ claGroupId: GROUP_ID }));
  const queryParamMap = new BehaviorSubject(convertToParamMap({ sig: 'signature-uuid-1' }));

  const getClaGroups = vi.fn();
  const getApprovalList = vi.fn();
  const updateApprovalList = vi.fn();
  const checkPermission = vi.fn(() => of(true));
  const getContributorAcknowledgments = vi.fn(() =>
    of({ signatureId: 'signature-uuid-1', list: [], canEdit: true, resultCount: 0, totalCount: 4, nextKey: null })
  );

  let confirmations: Confirmation[];

  function row(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupId: GROUP_ID,
      claGroupName: 'Nimbus Foundation CLA',
      projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD3AAI' }],
      signed: true,
      status: 'signed',
      needsClaManager: false,
      claManagersCount: 2,
      approvalCriteriaCount: 7,
      ...overrides,
    };
  }

  async function render(claGroup: OrgClaGroup = row()): Promise<ComponentFixture<OrgEasyclaDetailComponent>> {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [claGroup] }));

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap, queryParamMap, snapshot: { paramMap: paramMap.value, queryParamMap: queryParamMap.value, pathFromRoot: mountPath() } },
        },
        { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess: signal(true), selectedUrlSegment } },
        { provide: OrgRoleGrantsService, useValue: { loaded: signal(true), correlationId: signal(null) } },
        { provide: PersonaService, useValue: { personaLoaded: signal(true) } },
        { provide: OrgNavigationService, useValue: { loaded: signal(true) } },
        {
          provide: OrgLensEmptyStateService,
          useValue: {
            pageState: signal(null),
            hasPageState: signal(false),
            settled: signal(true),
            pageReady: signal(true),
            retrying: signal(false),
            retry: vi.fn(),
          },
        },
        {
          provide: OrgLensClaService,
          useValue: {
            getClaGroups,
            getPdfUrl: vi.fn(),
            getCclaPreview: vi.fn(),
            getApprovalList,
            updateApprovalList,
            checkPermission,
            getContributorAcknowledgments,
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
      ],
    }).compileComponents();

    // The delete path inside the panel raises a confirmation; collected here so the test can
    // accept it, exactly as the panel's own spec does.
    confirmations = [];
    TestBed.inject(ConfirmationService).requireConfirmation$.subscribe((confirmation) => {
      if (confirmation) confirmations.push(confirmation);
    });

    const fixture = TestBed.createComponent(OrgEasyclaDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function byTestId(fixture: ComponentFixture<unknown>, id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  async function openApprovalTab(fixture: ComponentFixture<OrgEasyclaDetailComponent>): Promise<void> {
    byTestId(fixture, 'org-easycla-detail-tab-approval')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    selectedAccount.set(SELECTED_ACCOUNT);
    paramMap.next(convertToParamMap({ claGroupId: GROUP_ID }));
    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-1' }));
    getClaGroups.mockReset();
    getApprovalList.mockReset();
    updateApprovalList.mockReset();
    checkPermission.mockReset();
    checkPermission.mockReturnValue(of(true));
    getApprovalList.mockReturnValue(of({ signatureId: 'signature-uuid-1', entries: [{ kind: 'domain', value: 'example.com' }], canEdit: true }));
    updateApprovalList.mockReturnValue(of({ signatureId: 'signature-uuid-1', entries: [], canEdit: true }));
  });

  it('renders the approval list panel when the tab is selected', async () => {
    const fixture = await render();

    await openApprovalTab(fixture);

    expect(byTestId(fixture, 'org-easycla-approval-list')).not.toBeNull();
    expect(byTestId(fixture, 'org-easycla-detail-tab-empty')).toBeNull();
  });

  // One request, on the tab, not on the detail page's first paint.
  it('does not load the approval list until the tab is opened', async () => {
    const fixture = await render();

    expect(getApprovalList).not.toHaveBeenCalled();

    await openApprovalTab(fixture);

    expect(getApprovalList).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1');
  });

  it('shows the row count until the tab reports its own', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-approval')?.textContent?.trim()).toBe('7');
  });

  it('takes the count the tab reports after a write', async () => {
    updateApprovalList.mockReturnValue(
      of({
        signatureId: 'signature-uuid-1',
        entries: [
          { kind: 'domain', value: 'example.com' },
          { kind: 'domain', value: 'other.example.com' },
        ],
        canEdit: true,
      })
    );
    const fixture = await render();
    await openApprovalTab(fixture);

    byTestId(fixture, 'org-easycla-approval-delete')?.querySelector('button')?.click();
    fixture.detectChanges();
    confirmations[0].accept?.();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-approval')?.textContent?.trim()).toBe('2');
  });

  // The row's own count is absent on a deployment predating the producer field. A dash says the
  // deployment cannot tell us, which is not the same as reporting zero rules.
  it('shows a dash when the row carries no count', async () => {
    const fixture = await render(row({ approvalCriteriaCount: undefined }));

    expect(byTestId(fixture, 'org-easycla-detail-tab-badge-approval')?.textContent?.trim()).toBe('—');
  });
});

/**
 * The Auto ECLA toggle on the Overview (#1988).
 *
 * Rendered inside the signed-agreement path: the flag lives on the corporate signature record, so
 * an unsigned row has nothing to update. Hidden entirely when ACS denies the write — the design
 * withholds the control from a viewer who cannot use it, since the disabled-with-banner pattern
 * needs #1989 to explain itself. The write is optimistic: the toggle answers the click first and
 * rolls back on a refusal, using the producer's own sentence on the toast.
 */
describe('OrgEasyclaDetailComponent — the Auto ECLA toggle', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000AcmeOrgAAA', accountName: 'Acme' };
  const PAIR_PROJECT = 'a09410000182dD3AAI';

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(SELECTED_ACCOUNT);
  const mountPath = (): { paramMap: ReturnType<typeof convertToParamMap> }[] => [{ paramMap: convertToParamMap({}) }, { paramMap: paramMap.value }];
  const selectedUrlSegment = computed(() => selectedAccount()?.uid ?? null);
  const paramMap = new BehaviorSubject(convertToParamMap({ claGroupId: GROUP_ID }));
  const queryParamMap = new BehaviorSubject(convertToParamMap({ sig: 'signature-uuid-1' }));

  const getClaGroups = vi.fn();
  const checkPermission = vi.fn();
  const setAutoCreateEcla = vi.fn();
  const getContributorAcknowledgments = vi.fn();
  const addMessage = vi.fn();

  function row(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupId: GROUP_ID,
      claGroupName: 'Nimbus Foundation CLA',
      projects: [{ projectName: 'Cascade', projectSfid: PAIR_PROJECT }],
      pairProjectSfid: PAIR_PROJECT,
      signed: true,
      status: 'signed',
      needsClaManager: false,
      claManagersCount: 2,
      approvalCriteriaCount: 7,
      autoCreateEcla: false,
      ...overrides,
    };
  }

  async function render(claGroup: OrgClaGroup = row(), groups?: OrgClaGroup[]): Promise<ComponentFixture<OrgEasyclaDetailComponent>> {
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: groups ?? [claGroup] }));

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap, queryParamMap, snapshot: { paramMap: paramMap.value, queryParamMap: queryParamMap.value, pathFromRoot: mountPath() } },
        },
        { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess: signal(true), selectedUrlSegment } },
        { provide: OrgRoleGrantsService, useValue: { loaded: signal(true), correlationId: signal(null) } },
        { provide: PersonaService, useValue: { personaLoaded: signal(true) } },
        { provide: OrgNavigationService, useValue: { loaded: signal(true) } },
        {
          provide: OrgLensEmptyStateService,
          useValue: {
            pageState: signal(null),
            hasPageState: signal(false),
            settled: signal(true),
            pageReady: signal(true),
            retrying: signal(false),
            retry: vi.fn(),
          },
        },
        {
          provide: OrgLensClaService,
          useValue: {
            getClaGroups,
            getPdfUrl: vi.fn(),
            getCclaPreview: vi.fn(),
            getApprovalList: vi.fn(),
            updateApprovalList: vi.fn(),
            checkPermission,
            getManagers: vi.fn(() => of({ signatureId: 'signature-uuid-1', managers: [] })),
            addManager: vi.fn(),
            removeManager: vi.fn(),
            getContributorAcknowledgments,
            setAutoCreateEcla,
          },
        },
        { provide: MessageService, useValue: { add: addMessage } },
        ConfirmationService,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function byTestId(fixture: ComponentFixture<unknown>, id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  beforeEach(() => {
    selectedAccount.set(SELECTED_ACCOUNT);
    paramMap.next(convertToParamMap({ claGroupId: GROUP_ID }));
    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-1' }));
    getClaGroups.mockReset();
    checkPermission.mockReset();
    checkPermission.mockReturnValue(of(true));
    setAutoCreateEcla.mockReset();
    setAutoCreateEcla.mockReturnValue(of({ autoCreateEcla: true }));
    getContributorAcknowledgments.mockReset();
    getContributorAcknowledgments.mockReturnValue(
      of({ signatureId: 'signature-uuid-1', list: [], canEdit: true, resultCount: 0, totalCount: 0, nextKey: null })
    );
    addMessage.mockReset();
  });

  it('asks ACS for the auto-ecla-update grant with the pair project SFID', async () => {
    await render();

    expect(checkPermission).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'auto-ecla-update', PAIR_PROJECT);
  });

  it('renders the toggle when ACS allows the write on a signed row', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-auto-ecla')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#org-easycla-detail-auto-ecla-toggle')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('label[for="org-easycla-detail-auto-ecla-toggle"]')).not.toBeNull();
  });

  it('hides the toggle when ACS denies, rather than rendering it disabled', async () => {
    checkPermission.mockReturnValue(of(false));

    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-detail-auto-ecla')).toBeNull();
  });

  it('withholds the toggle from an unsigned agreement, so no ACS hop fires either', async () => {
    const fixture = await render(row({ signed: false, autoCreateEcla: undefined }));

    expect(byTestId(fixture, 'org-easycla-detail-auto-ecla')).toBeNull();
    expect(checkPermission).not.toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'auto-ecla-update', expect.anything());
  });

  it('PUTs the target state and shows the new value optimistically', async () => {
    setAutoCreateEcla.mockReturnValue(of({ autoCreateEcla: true }));
    const fixture = await render(row({ autoCreateEcla: false }));

    const component = fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void; autoEclaValue: () => boolean };
    component.onAutoEclaToggle(true);
    fixture.detectChanges();

    expect(setAutoCreateEcla).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1', true);
    expect(component.autoEclaValue()).toBe(true);
  });

  it('labels the switch Auto ECLA and links to the docs', async () => {
    const fixture = await render(row({ autoCreateEcla: true }));

    const label = fixture.nativeElement.querySelector('label[for="org-easycla-detail-auto-ecla-toggle"]') as HTMLLabelElement;
    expect(label.textContent?.trim()).toBe('Auto ECLA');
    const targets = fixture.nativeElement.querySelectorAll('#org-easycla-detail-auto-ecla-toggle');
    expect(targets.length).toBe(1);
    expect((targets[0] as HTMLElement).tagName).toBe('INPUT');
    const link = byTestId(fixture, 'org-easycla-detail-auto-ecla-learn-more') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/docs');
    expect(link.textContent?.trim()).toBe('Learn more about Auto ECLA →');
  });

  it('describes what on and off mean for people on the approval list', async () => {
    setAutoCreateEcla.mockReturnValue(of({ autoCreateEcla: false }));
    const fixture = await render(row({ autoCreateEcla: true }));

    expect(byTestId(fixture, 'org-easycla-detail-auto-ecla-hint')?.textContent?.trim()).toBe(
      'On — employees matching the approval list are covered automatically.'
    );

    (fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void }).onAutoEclaToggle(false);
    fixture.detectChanges();

    expect(byTestId(fixture, 'org-easycla-detail-auto-ecla-hint')?.textContent?.trim()).toBe(
      "Off — employees matching the approval list still need to individually acknowledge this CLA before they're covered."
    );
  });

  it('confirms the written value with a success toast', async () => {
    setAutoCreateEcla.mockReturnValue(of({ autoCreateEcla: true }));
    const fixture = await render(row({ autoCreateEcla: false }));

    (fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void }).onAutoEclaToggle(true);
    fixture.detectChanges();

    expect(addMessage).toHaveBeenCalledWith({ severity: 'success', summary: 'Auto ECLA turned on.' });
  });

  it('keeps the requested value when a successful write comes back without the echo', async () => {
    setAutoCreateEcla.mockReturnValue(of(null));
    const fixture = await render(row({ autoCreateEcla: false }));

    (fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void }).onAutoEclaToggle(true);
    fixture.detectChanges();

    expect((fixture.componentInstance as unknown as { autoEclaValue: () => boolean }).autoEclaValue()).toBe(true);
    expect(addMessage).toHaveBeenCalledWith({ severity: 'success', summary: 'Auto ECLA turned on.' });
  });

  it('does not confirm a write that finished after the manager left the agreement', async () => {
    const answer = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValue(answer.asObservable());
    const fixture = await render(row({ autoCreateEcla: true }));

    (fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void }).onAutoEclaToggle(false);
    selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
    fixture.detectChanges();
    answer.next({ autoCreateEcla: false });
    answer.complete();

    expect(addMessage).not.toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('rolls back and toasts with the producer sentence when the write is refused', async () => {
    const error = new HttpErrorResponse({
      status: 403,
      error: { error: 'This organization is on the OFAC list. Contact support.' },
    });
    setAutoCreateEcla.mockReturnValue(throwError(() => error));
    const fixture = await render(row({ autoCreateEcla: false }));

    const component = fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void; autoEclaValue: () => boolean };
    component.onAutoEclaToggle(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Row's original false value survives the failed write, so the toggle tells the truth.
    expect(component.autoEclaValue()).toBe(false);
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        detail: 'This organization is on the OFAC list. Contact support.',
      })
    );
  });

  it('falls back to generic copy when the refusal carries no producer sentence', async () => {
    setAutoCreateEcla.mockReturnValue(throwError(() => ({ status: 500, error: null })));
    const fixture = await render(row({ autoCreateEcla: false }));

    const component = fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void };
    component.onAutoEclaToggle(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: "Couldn't turn Auto ECLA on",
        detail: 'Please try again in a moment.',
      })
    );
  });

  it('does not issue a second write while one is in flight', async () => {
    const answer = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValue(answer.asObservable());
    const fixture = await render(row({ autoCreateEcla: false }));

    const component = fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void };
    component.onAutoEclaToggle(true);
    component.onAutoEclaToggle(false);
    fixture.detectChanges();

    // Only the first click reached the network — the second is refused while the first is running.
    expect(setAutoCreateEcla).toHaveBeenCalledTimes(1);
    expect(setAutoCreateEcla).toHaveBeenCalledWith(SELECTED_ACCOUNT.uid, 'signature-uuid-1', true);

    answer.next({ autoCreateEcla: true });
    answer.complete();
  });

  it('clears the pending flag and ignores a late refusal after the organization changes', async () => {
    const answer = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValue(answer.asObservable());
    const fixture = await render(row({ autoCreateEcla: false }));

    const component = fixture.componentInstance as unknown as {
      onAutoEclaToggle: (v: boolean) => void;
      autoEclaPending: () => boolean;
    };
    component.onAutoEclaToggle(true);
    expect(component.autoEclaPending()).toBe(true);

    selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.autoEclaPending()).toBe(false);

    answer.error(new HttpErrorResponse({ status: 403, error: { error: 'This organization is on the OFAC list. Contact support.' } }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(addMessage).not.toHaveBeenCalled();
  });

  it('does not start a second write when the manager returns to the agreement the first write is for', async () => {
    const answer = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValue(answer.asObservable());
    const fixture = await render(row({ autoCreateEcla: false }));
    const component = fixture.componentInstance as unknown as {
      onAutoEclaToggle: (v: boolean) => void;
      autoEclaPending: () => boolean;
      autoEclaValue: () => boolean;
    };

    component.onAutoEclaToggle(true);
    selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
    fixture.detectChanges();
    await fixture.whenStable();

    selectedAccount.set(SELECTED_ACCOUNT);
    fixture.detectChanges();
    await fixture.whenStable();
    component.onAutoEclaToggle(false);

    expect(setAutoCreateEcla).toHaveBeenCalledTimes(1);
    expect(component.autoEclaPending()).toBe(true);
  });

  it('disables the toggle again when the agreement with a running write arrives after the organization switch', async () => {
    const answer = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValue(answer.asObservable());
    const fixture = await render(row({ autoCreateEcla: false }));
    const component = fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void; autoEclaPending: () => boolean };

    component.onAutoEclaToggle(true);
    getClaGroups.mockReturnValue(of({ orgUid: '0014100000OtherOrgAA', claGroups: [] }));
    selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.autoEclaPending()).toBe(false);

    const returning = new Subject<{ orgUid: string; claGroups: OrgClaGroup[] }>();
    getClaGroups.mockReturnValue(returning.asObservable());
    selectedAccount.set(SELECTED_ACCOUNT);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.autoEclaPending()).toBe(false);

    returning.next({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [row({ autoCreateEcla: false })] });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.autoEclaPending()).toBe(true);
  });

  it('refuses a second write after leaving and coming back while the first is still running', async () => {
    const answer = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValue(answer.asObservable());
    const first = await render(row({ autoCreateEcla: false }));
    (first.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void }).onAutoEclaToggle(true);
    first.destroy();

    const returned = TestBed.createComponent(OrgEasyclaDetailComponent);
    returned.detectChanges();
    await returned.whenStable();
    returned.detectChanges();
    const component = returned.componentInstance as unknown as {
      onAutoEclaToggle: (v: boolean) => void;
      autoEclaPending: () => boolean;
      autoEclaValue: () => boolean;
    };

    expect(component.autoEclaPending()).toBe(true);
    component.onAutoEclaToggle(true);
    expect(setAutoCreateEcla).toHaveBeenCalledTimes(1);

    answer.next({ autoCreateEcla: true });
    answer.complete();
    returned.detectChanges();

    expect(component.autoEclaPending()).toBe(false);
    expect(component.autoEclaValue()).toBe(true);
    component.onAutoEclaToggle(true);
    expect(setAutoCreateEcla).toHaveBeenCalledTimes(1);
  });

  it('keeps the value being written when a stale row happens to match it, across leaving and coming back', async () => {
    const answer = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValueOnce(of({ autoCreateEcla: true })).mockReturnValueOnce(answer.asObservable());
    const first = await render(row({ autoCreateEcla: false }));
    const toggle = first.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void };
    toggle.onAutoEclaToggle(true);
    first.detectChanges();
    toggle.onAutoEclaToggle(false);
    first.detectChanges();
    first.destroy();

    // The list now carries the first write.
    getClaGroups.mockReturnValue(of({ orgUid: SELECTED_ACCOUNT.uid, claGroups: [row({ autoCreateEcla: true })] }));
    const returned = TestBed.createComponent(OrgEasyclaDetailComponent);
    returned.detectChanges();
    await returned.whenStable();
    returned.detectChanges();
    const component = returned.componentInstance as unknown as { autoEclaPending: () => boolean; autoEclaValue: () => boolean };

    expect(component.autoEclaPending()).toBe(true);
    expect(component.autoEclaValue()).toBe(false);
  });

  it('trusts a list fetched after the write settled over the remembered value', async () => {
    const first = await render(row({ autoCreateEcla: false }));
    (first.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void }).onAutoEclaToggle(true);
    first.destroy();

    // Another CLA manager turned it back off before this visit.
    const returned = TestBed.createComponent(OrgEasyclaDetailComponent);
    returned.detectChanges();
    await returned.whenStable();
    returned.detectChanges();
    const component = returned.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void; autoEclaValue: () => boolean };

    expect(component.autoEclaValue()).toBe(false);
    component.onAutoEclaToggle(true);
    expect(setAutoCreateEcla).toHaveBeenCalledTimes(2);
  });

  it('shows the rolled-back value after leaving and coming back when the running write is refused', async () => {
    const answer = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValue(answer.asObservable());
    const first = await render(row({ autoCreateEcla: true }));
    (first.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void }).onAutoEclaToggle(false);
    first.destroy();

    const returned = TestBed.createComponent(OrgEasyclaDetailComponent);
    returned.detectChanges();
    await returned.whenStable();
    returned.detectChanges();
    const component = returned.componentInstance as unknown as { autoEclaValue: () => boolean };
    expect(component.autoEclaValue()).toBe(false);

    answer.error(new HttpErrorResponse({ status: 403, error: { error: 'This organization is on the OFAC list. Contact support.' } }));
    returned.detectChanges();

    expect(component.autoEclaValue()).toBe(true);
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('ignores an older response once a write for another organization is in flight', async () => {
    const first = new Subject<{ autoCreateEcla: boolean }>();
    const second = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValueOnce(first.asObservable()).mockReturnValueOnce(second.asObservable());
    const fixture = await render(row({ autoCreateEcla: false }));
    const component = fixture.componentInstance as unknown as {
      onAutoEclaToggle: (v: boolean) => void;
      autoEclaValue: () => boolean;
    };

    component.onAutoEclaToggle(true);
    selectedAccount.set({ uid: '0014100000OtherOrgAA', accountName: 'Other' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    component.onAutoEclaToggle(true);
    first.error(new HttpErrorResponse({ status: 403, error: { error: 'This organization is on the OFAC list. Contact support.' } }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(setAutoCreateEcla).toHaveBeenCalledTimes(2);
    expect(component.autoEclaValue()).toBe(true);
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('rolls the optimistic value back without a toast when the refusal arrives on another agreement in the same project', async () => {
    const answer = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValue(answer.asObservable());
    const here = row({ id: 'signature-uuid-1', autoCreateEcla: false });
    const there = row({ id: 'signature-uuid-2', autoCreateEcla: false });
    const fixture = await render(here, [here, there]);
    const component = fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void; autoEclaValue: () => boolean };

    component.onAutoEclaToggle(true);
    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-2' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    answer.error(new HttpErrorResponse({ status: 403, error: { error: 'This organization is on the OFAC list. Contact support.' } }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(addMessage).not.toHaveBeenCalled();

    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-1' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.autoEclaValue()).toBe(false);
  });

  it('does not start a second write for an agreement that already has one after another agreement was written', async () => {
    const first = new Subject<{ autoCreateEcla: boolean }>();
    const second = new Subject<{ autoCreateEcla: boolean }>();
    setAutoCreateEcla.mockReturnValueOnce(first.asObservable()).mockReturnValueOnce(second.asObservable());
    const here = row({ id: 'signature-uuid-1', autoCreateEcla: false });
    const there = row({ id: 'signature-uuid-2', autoCreateEcla: false });
    const fixture = await render(here, [here, there]);
    const component = fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void; autoEclaPending: () => boolean };

    component.onAutoEclaToggle(true);
    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-2' }));
    fixture.detectChanges();
    await fixture.whenStable();
    component.onAutoEclaToggle(true);

    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-1' }));
    fixture.detectChanges();
    await fixture.whenStable();
    component.onAutoEclaToggle(false);

    expect(setAutoCreateEcla).toHaveBeenCalledTimes(2);
    expect(component.autoEclaPending()).toBe(true);
  });

  it('keeps a confirmed value after visiting an agreement on another project', async () => {
    setAutoCreateEcla.mockReturnValue(of({ autoCreateEcla: true }));
    const here = row({ id: 'signature-uuid-1', autoCreateEcla: false, pairProjectSfid: PAIR_PROJECT });
    const elsewhere = row({
      id: 'signature-uuid-2',
      autoCreateEcla: false,
      pairProjectSfid: 'a09410000182dD9AAI',
      projects: [{ projectName: 'Other', projectSfid: 'a09410000182dD9AAI' }],
    });
    const fixture = await render(here, [here, elsewhere]);
    const component = fixture.componentInstance as unknown as { onAutoEclaToggle: (v: boolean) => void; autoEclaValue: () => boolean };

    component.onAutoEclaToggle(true);
    fixture.detectChanges();
    await fixture.whenStable();

    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-2' }));
    fixture.detectChanges();
    await fixture.whenStable();
    queryParamMap.next(convertToParamMap({ sig: 'signature-uuid-1' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.autoEclaValue()).toBe(true);
  });
});
