// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Account, OrgItem, OrgLensEmptyStateName, OrgLensLookupOutcome, OrgLensStaffCheck } from '@lfx-one/shared/interfaces';
import { orgUrlSegment } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, MockInstance, vi } from 'vitest';

import { OrgNotFoundComponent } from './org-not-found.component';

const HELD_ROW: OrgItem = { uid: 'held-uid', name: 'Held Org', accountId: 'held-uid', slug: 'held-org' } as OrgItem;

interface Harness {
  fixture: ComponentFixture<OrgNotFoundComponent>;
  items: WritableSignal<OrgItem[]>;
  listLoaded: WritableSignal<boolean>;
  listFailed: WritableSignal<boolean>;
  isStaff: WritableSignal<boolean>;
  lookupOutcome: WritableSignal<OrgLensLookupOutcome>;
  staffCheck: WritableSignal<OrgLensStaffCheck>;
  refresh: Mock<(bypassCache?: boolean) => unknown>;
  grantsLoading: WritableSignal<boolean>;
  refreshList: Mock<(uid?: string | null) => void>;
  writerSet: WritableSignal<Set<string>>;
  selectedAccount: WritableSignal<Account>;
  navigate: MockInstance<Router['navigate']>;
  setAccount: Mock<(account: Account) => void>;
  navigateToSelectedOrg: Mock<(intent: string) => void>;
}

function setup(): Harness {
  const items = signal<OrgItem[]>([]);
  const listLoaded = signal(true);
  const listFailed = signal(false);
  const isStaff = signal(false);
  const lookupOutcome = signal<OrgLensLookupOutcome>('ok');
  const staffCheck = signal<OrgLensStaffCheck>('ok');
  const refresh: Mock<(bypassCache?: boolean) => unknown> = vi.fn(() => of(undefined));
  const grantsLoading = signal(false);
  const refreshList: Mock<(uid?: string | null) => void> = vi.fn();
  const writerSet = signal(new Set<string>());
  const selectedAccount = signal<Account>({ accountId: '', accountName: '', membershipTier: '', logoUrl: null, uid: '', slug: null });
  const setAccount: Mock<(account: Account) => void> = vi.fn((account: Account) => selectedAccount.set(account));
  const navigateToSelectedOrg: Mock<(intent: string) => void> = vi.fn();
  const empty = new Set<string>();

  // The REAL `OrgLensEmptyStateService` runs here, so the dead end is tested against the page's own
  // outage head — a regression in `classifyLookup` fails these cells too.
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      MessageService,
      OrgLensEmptyStateService,
      { provide: OrgNavigationService, useValue: { items, loaded: listLoaded, loading: signal(false), upstreamFailed: listFailed, refreshList } },
      { provide: OrgLensNavigationService, useValue: { navigateToSelectedOrg } },
      {
        provide: OrgRoleGrantsService,
        useValue: {
          loaded: signal(true),
          loading: grantsLoading,
          isStaff,
          lookupOutcome,
          staffCheck,
          correlationId: signal('ref-1'),
          writerSet,
          auditorSet: signal(empty),
          inheritedWriterSet: signal(empty),
          inheritedAuditorSet: signal(empty),
          refresh,
        },
      },
      { provide: PersonaService, useValue: { personaLoaded: signal(true) } },
      {
        provide: AccountContextService,
        useValue: {
          selectedAccount,
          selectedUrlSegment: computed(() => orgUrlSegment(selectedAccount())),
          hasOrgSelectorAccess: signal(true),
          getStoredUid: () => 'cookie-uid',
          setAccount,
          refreshCanonicalRecord: vi.fn(() => Promise.resolve()),
        },
      },
    ],
  });

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(OrgNotFoundComponent);
  fixture.detectChanges();
  return {
    fixture,
    items,
    listLoaded,
    listFailed,
    isStaff,
    lookupOutcome,
    staffCheck,
    refresh,
    grantsLoading,
    refreshList,
    writerSet,
    selectedAccount,
    navigate,
    setAccount,
    navigateToSelectedOrg,
  };
}

function renderedState(h: Harness): string | null {
  h.fixture.detectChanges();
  return (h.fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-not-found-state"]')?.getAttribute('data-state') ?? null;
}

// The dead end's own tail plus the shared outage head, cell by cell. Every row is one where a
// neighbouring rule would answer differently — the #2090 class ("a broken lookup reads as a denial")
// reopened here twice during review, once per missing cell.
describe('OrgNotFoundComponent.state', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  it('renders no-access when a clean lookup holds nothing (FR-007)', () => {
    expect(renderedState(h)).toBe<OrgLensEmptyStateName>('no-access');
  });

  it('renders wrong-organization with the held list when a clean lookup holds something (FR-008)', () => {
    h.items.set([HELD_ROW]);

    expect(renderedState(h)).toBe<OrgLensEmptyStateName>('wrong-organization');
    expect((h.fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-not-found-org-held-uid"]')).not.toBeNull();
  });

  it('keeps wrong-organization on a partial roster that still holds something — rule 3 must not short-circuit', () => {
    h.items.set([HELD_ROW]);
    h.lookupOutcome.set('partial');

    expect(renderedState(h)).toBe<OrgLensEmptyStateName>('wrong-organization');
  });

  it('renders could-not-load on a partial roster that holds nothing (rule 3)', () => {
    h.lookupOutcome.set('partial');

    expect(renderedState(h)).toBe<OrgLensEmptyStateName>('could-not-load');
  });

  it('renders could-not-load when the roster never loaded, even with rows from an earlier list (rule 2)', () => {
    h.items.set([HELD_ROW]);
    h.lookupOutcome.set('failed');

    expect(renderedState(h)).toBe<OrgLensEmptyStateName>('could-not-load');
  });

  it('renders could-not-load when the org list itself failed — an empty failed list is not a denial', () => {
    h.listFailed.set(true);

    expect(renderedState(h)).toBe<OrgLensEmptyStateName>('could-not-load');
  });

  it('renders staff-check-failed with the reference ahead of no-access (rule 4, FR-011)', () => {
    h.staffCheck.set('failed');

    expect(renderedState(h)).toBe<OrgLensEmptyStateName>('staff-check-failed');
    expect((h.fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-not-found-description"]')?.textContent).toContain('ref-1');
  });

  it('renders the staff search invite for an LF-team caller whatever the roster says (FR-012)', () => {
    h.isStaff.set(true);
    h.lookupOutcome.set('partial');

    expect(renderedState(h)).toBe<OrgLensEmptyStateName>('not-found-staff');
  });

  it('retries through the shared Retry: role grants, then the already-fetched list pinned to the cookie selection', () => {
    h.lookupOutcome.set('failed');
    h.fixture.detectChanges();

    ((h.fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-not-found-retry"] button') as HTMLButtonElement).click();

    expect(h.refresh).toHaveBeenCalledWith(true);
    expect(h.refreshList).toHaveBeenCalledWith('cookie-uid');
  });

  // The switcher's search replaces `items()` wholesale; a query that matches nothing must not turn a
  // holder into "holds nothing" and swap the state under them.
  it('classifies from the unfiltered grants when the list rows are filtered away', () => {
    h.writerSet.set(new Set(['some-org']));
    h.lookupOutcome.set('partial');

    expect(renderedState(h)).toBe<OrgLensEmptyStateName>('wrong-organization');
  });

  // End-to-end wiring of the throttle: role-grants loading → service `retrying` → page input → button.
  it('disables the rendered Retry while the role-grants refresh is in flight', () => {
    h.lookupOutcome.set('failed');
    h.grantsLoading.set(true);
    h.fixture.detectChanges();

    const button = (h.fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-not-found-retry"] button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    h.grantsLoading.set(false);
    h.fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });

  it('picks a held organization through the switcher\u2019s own selection path', () => {
    h.items.set([HELD_ROW]);
    h.fixture.detectChanges();

    ((h.fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-not-found-org-held-uid"]') as HTMLButtonElement).click();

    expect(h.setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: 'held-uid', slug: 'held-org', accountName: 'Held Org' }));
    expect(h.navigateToSelectedOrg).toHaveBeenCalledWith('switch');
    expect(h.navigate).not.toHaveBeenCalled();
  });

  // A row with no slug and a non-SFID uid has no URL segment, so the address-aware switch is a no-op;
  // the viewer must still leave the dead end, on the legacy address that renders the selection.
  it('picks a row with no URL segment through the legacy overview address', () => {
    h.items.set([{ uid: 'legacy-uuid-1234', name: 'Legacy Org', accountId: 'legacy-uuid-1234', slug: null } as OrgItem]);
    h.fixture.detectChanges();

    ((h.fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-not-found-org-legacy-uuid-1234"]') as HTMLButtonElement).click();

    expect(h.setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: 'legacy-uuid-1234' }));
    expect(h.navigateToSelectedOrg).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith(['/org', 'overview']);
  });
});
