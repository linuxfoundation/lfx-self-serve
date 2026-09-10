// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { CCLA_SIGN_COPY, ORG_CLA_NOT_STARTED_COPY } from '@lfx-one/shared/constants';
import type { OrgClaGroup } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { OrgNavigationService } from '@shared/services/org-navigation.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  async function render(): Promise<ComponentFixture<OrgEasyclaDetailComponent>> {
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
