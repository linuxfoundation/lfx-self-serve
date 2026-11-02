// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  EMPTY_ORG_CERTIFICATIONS_RESPONSE,
  EMPTY_ORG_TRAININGS_RESPONSE,
  ORG_CERTIFICATIONS_WINDOW_NOTE,
  ORG_TRAINING_NO_ROSTER_NOTE,
} from '@lfx-one/shared/constants';
import type { Account, OrgLensEmptyStateName, OrgTrainingStats } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensEmptyStateService } from '@shared/services/org-lens-empty-state.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { OrgRoleGrantsService } from '@shared/services/org-role-grants.service';
import { PersonDetailDrawerService } from '@shared/services/person-detail-drawer.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgTrainingComponent } from './org-training.component';

const ACME: Account = { accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' };

// <lfx-person-detail-drawer /> is mounted unconditionally, so it needs the signal surface it reads.
function personDrawerStub() {
  return {
    isOpen: signal(false),
    activeContext: signal(null),
    activeTab: signal('events'),
    loading: signal(false),
    error: signal(false),
    emailError: signal(false),
    emailsLoading: signal(false),
    identityUnavailable: signal(false),
    companyEmailsResolved: signal(false),
    detail: signal(null),
    companyEmails: signal([]),
    open: vi.fn(),
    close: vi.fn(),
    setTab: vi.fn(),
  };
}

interface RenderOptions {
  settled?: boolean;
  stats?: OrgTrainingStats | null;
  /** Answers the stats read per organization; defaults to `stats` for any. */
  statsFor?: (orgUid: string) => Observable<OrgTrainingStats | null>;
  selectedAccount?: WritableSignal<Account>;
}

async function render(
  state: OrgLensEmptyStateName | null,
  { settled = true, stats = null, statsFor, selectedAccount = signal<Account>(ACME) }: RenderOptions = {}
) {
  const pageState = signal<OrgLensEmptyStateName | null>(state);

  await TestBed.configureTestingModule({
    imports: [OrgTrainingComponent],
    providers: [
      provideRouter([]),
      MessageService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
      { provide: AccountContextService, useValue: { selectedAccount } },
      { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
      {
        provide: OrgLensEmptyStateService,
        useValue: {
          pageState,
          hasPageState: computed(() => pageState() !== null),
          pageReady: signal(true),
          settled: signal(settled),
          retrying: signal(false),
          retry: vi.fn(),
        },
      },
      {
        provide: OrgLensTrainingService,
        useValue: {
          getTrainingStats: statsFor ?? (() => of(stats)),
          getOrgCertifications: () => of(EMPTY_ORG_CERTIFICATIONS_RESPONSE),
          getOrgTrainings: () => of(EMPTY_ORG_TRAININGS_RESPONSE),
        },
      },
      { provide: PersonDetailDrawerService, useValue: personDrawerStub() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgTrainingComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('OrgTrainingComponent', () => {
  it('replaces the page with the contractor-no-grant state and renders none of its data sections or the org name', async () => {
    const el = await render('contractor-no-grant');

    expect(el.querySelector('[data-testid="org-training-no-access-state"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-training-stats"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-training-content-card"]')).toBeNull();
    expect(el.textContent).not.toContain('Acme Motors, Inc.');
  });

  it('shows a skeleton instead of a blank area while the org context is still settling, without naming the org', async () => {
    const el = await render(null, { settled: false });

    expect(el.querySelector('[data-testid="org-training-skeleton"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-training-stats"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-training-content-card"]')).toBeNull();
    expect(el.textContent).not.toContain('Acme Motors, Inc.');
  });

  it('states the enrollment window above the Certifications table', async () => {
    const el = await render(null);

    expect(el.querySelector('[data-testid="org-certifications-window-note"]')?.textContent?.trim()).toBe(ORG_CERTIFICATIONS_WINDOW_NOTE);
  });
});

describe('OrgTrainingComponent — stat strip', () => {
  const stats: OrgTrainingStats = {
    rosterMembers: 1250,
    rosterMembersAsOf: '2026-10-29T23:00:00.000Z',
    peopleWithTrainingActivity: 830,
    trainingActivityAsOf: '2026-10-30T09:48:21.094Z',
    certifiedEmployees: 140,
    certificationsEarned: 190,
    employeesInTraining: 25,
    trainingCoursesEnrolled: 31,
    inProgressAsOf: '2026-11-01T10:15:00.000Z',
  };

  const value = (el: HTMLElement, testId: string) => el.querySelector(`[data-testid="${testId}-value"]`)?.textContent?.trim();

  it('shows roster members and people with training activity among the cumulative numbers, and in-progress counts only in the snapshot row', async () => {
    const el = await render(null, { stats });
    const snapshot = el.querySelector('[data-testid="org-training-stats-snapshot"]') as HTMLElement;

    expect(value(el, 'org-training-stat-roster-members')).toBe('1,250');
    expect(value(el, 'org-training-stat-people-with-training-activity')).toBe('830');
    expect(value(el, 'org-training-stat-certified-employees')).toBe('140');
    expect(snapshot.querySelector('[data-testid="org-training-stat-employees-in-training"]')).not.toBeNull();
    expect(snapshot.querySelector('[data-testid="org-training-stat-training-courses-enrolled"]')).not.toBeNull();
    expect(snapshot.querySelector('[data-testid="org-training-stat-roster-members"]')).toBeNull();
    expect(snapshot.querySelector('[data-testid="org-training-stat-people-with-training-activity"]')).toBeNull();
    expect(value(el, 'org-training-stat-employees-in-training')).toBe('25');
  });

  it('states each number’s as-of date under it', async () => {
    const el = await render(null, { stats });
    const caption = (testId: string) => el.querySelector(`[data-testid="${testId}-caption"]`)?.textContent ?? '';

    expect(caption('org-training-stat-roster-members')).toContain('Oct 29, 2026');
    expect(caption('org-training-stat-people-with-training-activity')).toContain('Oct 30, 2026');
    expect(caption('org-training-stat-employees-in-training')).toContain('Nov 1, 2026');
  });

  it('shows a dash, not zero, for the roster of an org without a training program', async () => {
    const el = await render(null, { stats: { ...stats, rosterMembers: null, rosterMembersAsOf: null } });

    expect(value(el, 'org-training-stat-roster-members')).toBe('—');
    expect(el.querySelector('[data-testid="org-training-stat-roster-members-caption"]')?.textContent?.trim()).toBe(ORG_TRAINING_NO_ROSTER_NOTE);
    expect(value(el, 'org-training-stat-people-with-training-activity')).toBe('830');
  });

  it('states no as-of date and no previous organization’s captions while the stats load, on first load and on an org switch', async () => {
    const responses: Record<string, Subject<OrgTrainingStats | null>> = {
      'org-uid-1': new Subject<OrgTrainingStats | null>(),
      'org-uid-2': new Subject<OrgTrainingStats | null>(),
    };
    const selectedAccount = signal<Account>(ACME);
    const el = await render(null, { selectedAccount, statsFor: (orgUid) => responses[orgUid].asObservable() });
    const appRef = TestBed.inject(ApplicationRef);
    const captions = () => [...el.querySelectorAll('[data-testid$="-caption"]')].map((node) => node.textContent ?? '');
    const snapshotAsOf = () => el.querySelector('[data-testid="org-training-stats-snapshot-as-of"]')?.textContent ?? null;

    // First load, before the stats arrive.
    expect(el.textContent).not.toContain('as-of date unavailable');
    expect(captions()).toEqual([]);
    expect(snapshotAsOf()).toBeNull();

    responses['org-uid-1'].next(stats);
    responses['org-uid-1'].complete();
    await appRef.whenStable();
    expect(captions().join(' ')).toContain('Oct 29, 2026');
    expect(snapshotAsOf()).toContain('Nov 1, 2026');

    // Switch to an organization whose stats are still on their way.
    selectedAccount.set({ ...ACME, accountId: 'acc-2', accountName: 'Globex Corp.', uid: 'org-uid-2', slug: 'globex' });
    await appRef.whenStable();
    expect(captions()).toEqual([]);
    expect(snapshotAsOf()).toBeNull();
    expect(value(el, 'org-training-stat-roster-members')).toBe('—');
    expect(el.textContent).not.toContain('Oct 29, 2026');

    responses['org-uid-2'].next({ ...stats, rosterMembersAsOf: '2026-10-31T23:00:00.000Z', inProgressAsOf: '2026-11-02T10:15:00.000Z' });
    responses['org-uid-2'].complete();
    await appRef.whenStable();
    expect(el.querySelector('[data-testid="org-training-stat-roster-members-caption"]')?.textContent).toContain('Oct 31, 2026');
    expect(snapshotAsOf()).toContain('Nov 2, 2026');
  });
});
