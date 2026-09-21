// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Account, OrgLensEmptyStateName, OrgLensLookupOutcome, OrgLensStaffCheck } from '@lfx-one/shared/interfaces';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgLensEmptyStateService } from './org-lens-empty-state.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { PersonaService } from './persona.service';

const HELD = 'held-org';
const OTHER = 'other-org';

interface Harness {
  service: OrgLensEmptyStateService;
  loaded: WritableSignal<boolean>;
  personaLoaded: WritableSignal<boolean>;
  isStaff: WritableSignal<boolean>;
  lookupOutcome: WritableSignal<OrgLensLookupOutcome>;
  staffCheck: WritableSignal<OrgLensStaffCheck>;
  writerSet: WritableSignal<Set<string>>;
  inheritedAuditorSet: WritableSignal<Set<string>>;
  selectedAccount: WritableSignal<Account>;
  hasOrgSelectorAccess: WritableSignal<boolean>;
  refresh: Mock<() => Observable<void>>;
}

function account(uid: string): Account {
  return { accountId: uid, accountName: uid, accountSlug: '', membershipTier: '', logoUrl: null, uid, slug: null };
}

function setup(): Harness {
  const loaded = signal(true);
  const personaLoaded = signal(true);
  const isStaff = signal(false);
  const lookupOutcome = signal<OrgLensLookupOutcome>('ok');
  const staffCheck = signal<OrgLensStaffCheck>('ok');
  const writerSet = signal(new Set<string>());
  const inheritedAuditorSet = signal(new Set<string>());
  const selectedAccount = signal<Account>(account(''));
  const hasOrgSelectorAccess = signal(false);
  const refresh: Mock<() => Observable<void>> = vi.fn(() => of(undefined));

  TestBed.configureTestingModule({
    providers: [
      {
        provide: OrgRoleGrantsService,
        useValue: {
          loaded,
          isStaff,
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
      { provide: AccountContextService, useValue: { selectedAccount, hasOrgSelectorAccess } },
    ],
  });

  return {
    service: TestBed.inject(OrgLensEmptyStateService),
    loaded,
    personaLoaded,
    isStaff,
    lookupOutcome,
    staffCheck,
    writerSet,
    inheritedAuditorSet,
    selectedAccount,
    hasOrgSelectorAccess,
    refresh,
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

  it('retry re-runs the role-grants lookup', () => {
    h.service.retry();

    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
});
