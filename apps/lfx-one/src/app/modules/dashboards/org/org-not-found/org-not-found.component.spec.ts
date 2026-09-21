// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OrgItem, OrgLensEmptyStateName, OrgLensLookupBlocker, OrgLensLookupOutcome, OrgLensStaffCheck } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

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
  orgLensEnabled: WritableSignal<boolean>;
  retry: Mock<() => void>;
  setAccount: Mock<() => void>;
  navigateToSelectedOrg: Mock<(intent: string) => void>;
}

function setup(): Harness {
  const items = signal<OrgItem[]>([]);
  const listLoaded = signal(true);
  const listFailed = signal(false);
  const isStaff = signal(false);
  const lookupOutcome = signal<OrgLensLookupOutcome>('ok');
  const staffCheck = signal<OrgLensStaffCheck>('ok');
  const orgLensEnabled = signal(true);
  const retry: Mock<() => void> = vi.fn();
  const setAccount: Mock<() => void> = vi.fn();
  const navigateToSelectedOrg: Mock<(intent: string) => void> = vi.fn();

  // The real outage head (FR-016 rules 2–4), so the dead end is tested against the page's own rules.
  const classifyLookup = (holdsAnything: boolean): OrgLensLookupBlocker | null => {
    const outcome = lookupOutcome();
    if (outcome === 'failed' || (outcome === 'partial' && !holdsAnything)) {
      return 'could-not-load';
    }
    return staffCheck() === 'failed' ? 'staff-check-failed' : null;
  };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      MessageService,
      { provide: FeatureFlagService, useValue: { getBooleanFlag: () => orgLensEnabled } },
      { provide: OrgNavigationService, useValue: { items, loaded: listLoaded, upstreamFailed: listFailed } },
      { provide: OrgLensNavigationService, useValue: { navigateToSelectedOrg } },
      { provide: OrgRoleGrantsService, useValue: { isStaff, lookupOutcome, staffCheck, correlationId: signal('ref-1') } },
      { provide: OrgLensEmptyStateService, useValue: { settled: signal(true), classifyLookup, retry } },
      {
        provide: AccountContextService,
        useValue: { hasOrgSelectorAccess: signal(true), setAccount, refreshCanonicalRecord: vi.fn(() => Promise.resolve()) },
      },
    ],
  });

  const fixture = TestBed.createComponent(OrgNotFoundComponent);
  fixture.detectChanges();
  return { fixture, items, listLoaded, listFailed, isStaff, lookupOutcome, staffCheck, orgLensEnabled, retry, setAccount, navigateToSelectedOrg };
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

  it('renders the static flag-off dead end with no registry state (spec 050 US5)', () => {
    h.orgLensEnabled.set(false);
    h.lookupOutcome.set('failed');

    expect(renderedState(h)).toBe('unavailable');
    expect((h.fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-not-found-title"]')?.textContent?.trim()).toBe('Organization not found');
  });

  it('retries through the shared Retry', () => {
    h.lookupOutcome.set('failed');
    h.fixture.detectChanges();

    ((h.fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-not-found-retry"] button') as HTMLButtonElement).click();

    expect(h.retry).toHaveBeenCalledTimes(1);
  });

  it('picks a held organization through the switcher\u2019s own selection path', () => {
    h.items.set([HELD_ROW]);
    h.fixture.detectChanges();

    ((h.fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-not-found-org-held-uid"]') as HTMLButtonElement).click();

    expect(h.setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: 'held-uid', slug: 'held-org', accountName: 'Held Org' }));
    expect(h.navigateToSelectedOrg).toHaveBeenCalledWith('switch');
  });
});
