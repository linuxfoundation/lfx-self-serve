// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Account, OrgLensEmptyStateName, OrgLensLookupOutcome, OrgLensStaffCheck } from '@lfx-one/shared/interfaces';
import { Observable, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgLensEmptyStateService } from './org-lens-empty-state.service';
import { OrgNavigationService } from './org-navigation.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { PersonaService } from './persona.service';

const HELD = 'held-org';
const OTHER = 'other-org';

interface Harness {
  service: OrgLensEmptyStateService;
  loaded: WritableSignal<boolean>;
  personaLoaded: WritableSignal<boolean>;
  isStaff: WritableSignal<boolean>;
  isContractor: WritableSignal<boolean>;
  /** Answers of the read gate (`OrgRoleGrantsService.readCheck`), one Subject per call. */
  readCheck: Mock<(uid: string) => Observable<boolean>>;
  readAnswers: Subject<boolean>[];
  lookupOutcome: WritableSignal<OrgLensLookupOutcome>;
  staffCheck: WritableSignal<OrgLensStaffCheck>;
  writerSet: WritableSignal<Set<string>>;
  inheritedAuditorSet: WritableSignal<Set<string>>;
  selectedAccount: WritableSignal<Account>;
  hasOrgSelectorAccess: WritableSignal<boolean>;
  refresh: Mock<(bypassCache?: boolean) => Observable<void>>;
  listLoaded: WritableSignal<boolean>;
  listLoading: WritableSignal<boolean>;
  grantsLoading: WritableSignal<boolean>;
  refreshList: Mock<(uid?: string | null) => number>;
  /** What the real pipeline does when a first page lands: record its generation and clear `loading`. */
  landFirstPage: () => void;
  /** What the real first-page pipeline does on a fetch: bump the generation and raise `loading`. */
  startListFetch: () => number;
}

function account(uid: string): Account {
  return { accountId: uid, accountName: uid, membershipTier: '', logoUrl: null, uid, slug: null };
}

function setup(): Harness {
  const loaded = signal(true);
  const personaLoaded = signal(true);
  const isStaff = signal(false);
  const isContractor = signal(false);
  const readAnswers: Subject<boolean>[] = [];
  const readCheck: Mock<(uid: string) => Observable<boolean>> = vi.fn(() => {
    const answer = new Subject<boolean>();
    readAnswers.push(answer);
    return answer.asObservable();
  });
  const lookupOutcome = signal<OrgLensLookupOutcome>('ok');
  const staffCheck = signal<OrgLensStaffCheck>('ok');
  const writerSet = signal(new Set<string>());
  const inheritedAuditorSet = signal(new Set<string>());
  const selectedAccount = signal<Account>(account(''));
  const hasOrgSelectorAccess = signal(false);
  const refresh: Mock<(bypassCache?: boolean) => Observable<void>> = vi.fn(() => of(undefined));
  const grantsLoading = signal(false);
  const listLoaded = signal(false);
  const listLoading = signal(false);
  const listGeneration = signal(0);
  const startListFetch = (): number => {
    listGeneration.update((g) => g + 1);
    listLoading.set(true);
    return listGeneration();
  };
  const firstPageLanded = signal(0);
  const landFirstPage = (): void => {
    firstPageLanded.set(listGeneration());
    listLoading.set(false);
  };
  const refreshList: Mock<(uid?: string | null) => number> = vi.fn(() => listGeneration());

  TestBed.configureTestingModule({
    providers: [
      {
        provide: OrgRoleGrantsService,
        useValue: {
          loaded,
          loading: grantsLoading,
          isStaff,
          isContractor,
          readCheck,
          lookupOutcome,
          staffCheck,
          writerSet,
          auditorSet: signal(new Set<string>()),
          inheritedWriterSet: signal(new Set<string>()),
          inheritedAuditorSet,
          refresh,
        },
      },
      { provide: PersonaService, useValue: { personaLoaded } },
      { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess, getStoredUid: () => 'cookie-uid' } },
      {
        provide: OrgNavigationService,
        useValue: { loaded: listLoaded, loading: listLoading, generation: listGeneration, firstPageLandedGeneration: firstPageLanded, refreshList },
      },
    ],
  });

  return {
    service: TestBed.inject(OrgLensEmptyStateService),
    loaded,
    personaLoaded,
    isStaff,
    isContractor,
    readCheck,
    readAnswers,
    lookupOutcome,
    staffCheck,
    writerSet,
    inheritedAuditorSet,
    selectedAccount,
    hasOrgSelectorAccess,
    refresh,
    listLoaded,
    listLoading,
    grantsLoading,
    refreshList,
    startListFetch,
    landFirstPage,
  };
}

// FR-016 precedence. Each row is one cell of `lookupOutcome × staffCheck × selectedHeld × holdsAnything`
// where a neighbouring rule would answer differently — the table drifts silently otherwise.
describe('OrgLensEmptyStateService.pageState', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  it('renders nothing (skeleton) until both bootstrap loads have answered', () => {
    h.loaded.set(false);
    h.lookupOutcome.set('failed');
    expect(h.service.settled()).toBe(false);
    expect(h.service.pageState()).toBeNull();

    h.loaded.set(true);
    h.personaLoaded.set(false);
    expect(h.service.pageState()).toBeNull();
  });

  // Rule 1 — the #2216 blocking fix: a present grant is authoritative whatever else failed.
  it('renders the page for a held selection even when the lookup is partial and the staff check failed', () => {
    h.selectedAccount.set(account(HELD));
    h.writerSet.set(new Set([HELD]));
    h.lookupOutcome.set('partial');
    h.staffCheck.set('failed');

    expect(h.service.selectedHeld()).toBe(true);
    expect(h.service.pageState()).toBeNull();
    // FR-010: the incomplete list is the switcher's notice, not a page state.
    expect(h.service.listIncomplete()).toBe(true);
  });

  it('counts an inherited grant as holding the selection', () => {
    h.selectedAccount.set(account(HELD));
    h.inheritedAuditorSet.set(new Set([HELD]));

    expect(h.service.pageState()).toBeNull();
  });

  it('treats an LF-team caller as holding every selection', () => {
    h.selectedAccount.set(account(OTHER));
    h.isStaff.set(true);

    expect(h.service.pageState()).toBeNull();
  });

  // Rule 2 — the #2090 class: a roster that never loaded is an outage, never a denial, and it is not
  // guarded by `holdsAnything` (persona-seeded accounts are not evidence of a grant).
  it('renders could-not-load when the lookup failed, whether or not the caller holds anything loaded', () => {
    h.lookupOutcome.set('failed');
    h.staffCheck.set('failed');

    expect(h.service.pageState()).toBe<OrgLensEmptyStateName>('could-not-load');

    h.hasOrgSelectorAccess.set(true);
    expect(h.service.pageState()).toBe<OrgLensEmptyStateName>('could-not-load');
  });

  // Rule 3 — partial is an outage only when the caller holds nothing at all.
  it('renders could-not-load for a partial lookup only when the caller holds nothing loaded', () => {
    h.lookupOutcome.set('partial');
    expect(h.service.pageState()).toBe<OrgLensEmptyStateName>('could-not-load');

    h.hasOrgSelectorAccess.set(true);
    // A partial roster with loaded holdings and an unheld selection: the selection is pending, not an outage.
    expect(h.service.pageState()).toBeNull();
  });

  // Rule 4 before 5 — FR-011: a failed team check never reads as the employee no-access copy.
  it('renders staff-check-failed ahead of no-organization', () => {
    h.staffCheck.set('failed');

    expect(h.service.pageState()).toBe<OrgLensEmptyStateName>('staff-check-failed');
  });

  it('renders no-organization for a clean lookup that holds nothing', () => {
    expect(h.service.pageState()).toBe<OrgLensEmptyStateName>('no-organization');
    expect(h.service.hasPageState()).toBe(true);
  });

  it('renders the page while a selection among loaded holdings is pending', () => {
    h.hasOrgSelectorAccess.set(true);
    h.selectedAccount.set(account(OTHER));

    expect(h.service.pageState()).toBeNull();
  });

  it('retry re-runs the role-grants lookup past the BFF cache and leaves a never-requested list to the switcher bootstrap', () => {
    h.service.retry();

    expect(h.refresh).toHaveBeenCalledWith(true);
    expect(h.refreshList).not.toHaveBeenCalled();
  });

  // The list is filtered server-side by the same lookup: refreshing grants alone would leave a list
  // that emptied during the outage stale after the grants recover. The refresh is the non-defaulting
  // one — it must never clear or re-point the selection (see org-navigation.service.spec).
  it('retry re-fetches a previously fetched list once the grants answer, pinning the selection', () => {
    h.listLoaded.set(true);
    h.selectedAccount.set(account(HELD));

    h.service.retry();

    expect(h.refreshList).toHaveBeenCalledWith(HELD);
  });

  it('retry falls back to the cookie uid when nothing is selected', () => {
    h.listLoaded.set(true);

    h.service.retry();

    expect(h.refreshList).toHaveBeenCalledWith('cookie-uid');
  });

  // The most likely moment to press Retry is while the first list fetch is still visibly loading;
  // the decision is made when the grants answer, not snapshotted at the click.
  it('retry refreshes a list that finished loading between the click and the grants answer', () => {
    const grants = new Subject<void>();
    h.refresh.mockReturnValue(grants.asObservable());
    h.listLoading.set(true);

    h.service.retry();
    expect(h.refreshList).not.toHaveBeenCalled();

    h.listLoading.set(false);
    h.listLoaded.set(true);
    grants.next();

    expect(h.refreshList).toHaveBeenCalledTimes(1);
  });

  // The `loading()` clause on its own: the first list fetch is still in flight when the grants answer.
  it('retry refreshes a list that is still in flight when the grants answer', () => {
    const grants = new Subject<void>();
    h.refresh.mockReturnValue(grants.asObservable());
    h.listLoading.set(true);
    h.listLoaded.set(false);

    h.service.retry();
    grants.next();

    expect(h.refreshList).toHaveBeenCalledTimes(1);
  });

  // The Retry control binds to `retrying`; it must stay disabled through BOTH phases with no gap at
  // the handoff, or a second click can fire a concurrent list reload — driven through `retry()`
  // itself, with the mocked list refresh starting a fetch synchronously as the real one does.
  it('retrying stays true across the grants → list handoff of a real retry', () => {
    const grants = new Subject<void>();
    h.refresh.mockImplementation(() => {
      h.grantsLoading.set(true);
      return grants.asObservable();
    });
    h.refreshList.mockImplementation(() => h.startListFetch());
    h.listLoaded.set(true);

    h.service.retry();
    expect(h.service.retrying()).toBe(true);

    h.grantsLoading.set(false);
    grants.next();
    // Handoff: grants settled, list fetch started inside the callback — no dip to false.
    expect(h.service.retrying()).toBe(true);

    h.landFirstPage();
    expect(h.service.retrying()).toBe(false);
  });

  // `orgNavigation.loading` is one flag for every list fetch; a switcher search must not mark Retry busy.
  it('retrying ignores list activity that no retry started', () => {
    h.startListFetch();

    expect(h.service.retrying()).toBe(false);
  });

  // After Retry's own first page lands, a scroll reuses the generation (next pages never bump it) and
  // raises `loading` again — that is the viewer paging, not Retry, so Retry stays idle.
  it('retrying stays false while the viewer pages the list after a completed retry', () => {
    h.refreshList.mockImplementation(() => h.startListFetch());
    h.listLoaded.set(true);

    h.service.retry();
    h.landFirstPage();
    expect(h.service.retrying()).toBe(false);

    h.listLoading.set(true);
    expect(h.service.retrying()).toBe(false);
  });

  it('retrying stays false for a new list fetch after a completed retry', () => {
    h.refreshList.mockImplementation(() => h.startListFetch());
    h.listLoaded.set(true);

    h.service.retry();
    h.landFirstPage();

    h.startListFetch();
    expect(h.service.retrying()).toBe(false);
  });

  // A search that supersedes Retry's own fetch keeps `loading` true for the search; Retry is released
  // at once rather than reading busy until the search settles.
  it('releases Retry as soon as a switcher search supersedes its list fetch', () => {
    h.refreshList.mockImplementation(() => h.startListFetch());
    h.listLoaded.set(true);

    h.service.retry();
    expect(h.service.retrying()).toBe(true);

    h.startListFetch();
    expect(h.service.retrying()).toBe(false);
  });

  // A second Retry before the first page lands starts a newer fetch; only that fetch's first page
  // releases it (the navigation service drops the superseded page before recording a landing).
  it('retrying stays true across back-to-back retries until the newest first page lands', () => {
    h.refreshList.mockImplementation(() => h.startListFetch());
    h.listLoaded.set(true);

    h.service.retry();
    expect(h.service.retrying()).toBe(true);

    h.service.retry();
    expect(h.refreshList).toHaveBeenCalledTimes(2);
    expect(h.service.retrying()).toBe(true);

    h.landFirstPage();
    expect(h.service.retrying()).toBe(false);
  });

  it('retry leaves a list that was never requested alone even after the grants answer', () => {
    const grants = new Subject<void>();
    h.refresh.mockReturnValue(grants.asObservable());

    h.service.retry();
    grants.next();

    expect(h.refreshList).not.toHaveBeenCalled();
  });
});

// The head the dead end shares with the page — `holdsAnything` is the only input the callers differ on.
describe('OrgLensEmptyStateService.classifyLookup', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  it('answers null for a clean lookup', () => {
    expect(h.service.classifyLookup(false)).toBeNull();
    expect(h.service.classifyLookup(true)).toBeNull();
  });

  it('answers could-not-load for a failed lookup whatever the caller holds', () => {
    h.lookupOutcome.set('failed');
    h.staffCheck.set('failed');

    expect(h.service.classifyLookup(false)).toBe('could-not-load');
    expect(h.service.classifyLookup(true)).toBe('could-not-load');
  });

  it('answers could-not-load for a partial lookup only when the caller holds nothing', () => {
    h.lookupOutcome.set('partial');

    expect(h.service.classifyLookup(false)).toBe('could-not-load');
    expect(h.service.classifyLookup(true)).toBeNull();
  });

  it('answers staff-check-failed for a failed team check on a loaded roster', () => {
    h.staffCheck.set('failed');

    expect(h.service.classifyLookup(false)).toBe('staff-check-failed');
    expect(h.service.classifyLookup(true)).toBe('staff-check-failed');
  });
});

// #2961 — an LF contractor the server refuses. The rule keys on the read gate's answer for the selected
// organization, never on the roster, so FGA-only readers (key-contact auditors) keep their page.
describe('OrgLensEmptyStateService.pageState — contractor-no-grant (#2961)', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
    h.isContractor.set(true);
  });

  it('tells a contractor with nothing selected and nothing held why, instead of the employee no-organization copy', () => {
    expect(h.service.pageState()).toBe('contractor-no-grant');

    h.isContractor.set(false);
    expect(h.service.pageState()).toBe('no-organization');
  });

  it('asks the read gate about a persona-seeded organization and shows the state only once it refuses', () => {
    h.hasOrgSelectorAccess.set(true);
    h.selectedAccount.set(account(OTHER));
    TestBed.tick();

    expect(h.readCheck).toHaveBeenCalledWith(OTHER);
    // Unanswered: a skeleton, never the zero-metric overview.
    expect(h.service.settled()).toBe(false);

    h.readAnswers[0].next(false);
    expect(h.service.settled()).toBe(true);
    expect(h.service.pageState()).toBe('contractor-no-grant');
  });

  it('renders the page when the read gate admits the organization (for example a key-contact auditor)', () => {
    h.hasOrgSelectorAccess.set(true);
    h.selectedAccount.set(account(OTHER));
    TestBed.tick();

    h.readAnswers[0].next(true);
    expect(h.service.settled()).toBe(true);
    expect(h.service.pageState()).toBeNull();
  });

  // The probe answer counts only for the organization it was asked about: switching A → B before A
  // answers must wait for B, and a late answer for A must decide nothing.
  it('never lets an answer for one organization decide another', () => {
    h.hasOrgSelectorAccess.set(true);
    h.selectedAccount.set(account(OTHER));
    TestBed.tick();
    h.selectedAccount.set(account(HELD + '-b'));
    TestBed.tick();

    expect(h.readCheck).toHaveBeenLastCalledWith(HELD + '-b');
    expect(h.service.settled()).toBe(false);

    h.readAnswers[0].next(false);
    expect(h.service.settled()).toBe(false);
    expect(h.service.pageState()).toBeNull();

    h.readAnswers[1].next(true);
    expect(h.service.settled()).toBe(true);
    expect(h.service.pageState()).toBeNull();
  });

  // Between a selection change and the probe restarting, the probe still holds the previous answer.
  it('does not apply the previous organization\u2019s refusal to a newly selected one', () => {
    h.hasOrgSelectorAccess.set(true);
    h.selectedAccount.set(account(OTHER));
    TestBed.tick();
    h.readAnswers[0].next(false);
    expect(h.service.pageState()).toBe('contractor-no-grant');

    // No tick: the new organization is selected but its read check has not started yet.
    h.selectedAccount.set(account(HELD + '-b'));
    expect(h.service.settled()).toBe(false);
    expect(h.service.pageState()).toBeNull();
  });

  // An FGA-only reader (key-contact auditor) can reach an organization through a deep link with no roster
  // row and no persona seed; the gate's admission must not fall through to the employee no-organization copy.
  it('keeps the page for an admitted contractor who holds nothing in the roster', () => {
    h.hasOrgSelectorAccess.set(false);
    h.selectedAccount.set(account(OTHER));
    TestBed.tick();

    h.readAnswers[0].next(true);
    expect(h.service.pageState()).toBeNull();
  });

  it('never probes an organization the contractor holds through an explicit grant', () => {
    h.hasOrgSelectorAccess.set(true);
    h.writerSet.set(new Set([HELD]));
    h.selectedAccount.set(account(HELD));
    TestBed.tick();

    expect(h.readCheck).not.toHaveBeenCalled();
    expect(h.service.pageState()).toBeNull();
  });

  it('keeps the outage states ahead of it', () => {
    h.lookupOutcome.set('failed');
    expect(h.service.pageState()).toBe('could-not-load');

    h.lookupOutcome.set('ok');
    h.staffCheck.set('failed');
    expect(h.service.pageState()).toBe('staff-check-failed');
  });
});
