// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTEE_FIND_PROGRAM_URL,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_UNKNOWN_BADGE_CLASS,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeApplicationHistoryEntry } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApplicationHistoryComponent } from './application-history.component';

describe('ApplicationHistoryComponent', () => {
  const entries: MentorshipMenteeApplicationHistoryEntry[] = [
    {
      id: 'app_accepted',
      programId: 'prog_gridflow',
      programName: 'GridFlow: Ingestion Pipeline',
      termName: 'Fall 2026',
      submittedOn: 'Jun 28, 2026',
      status: 'accepted',
    },
    {
      id: 'app_pending',
      programId: 'prog_apicurio',
      programName: 'Apicurio Registry: Playground',
      termName: 'Fall 2026',
      submittedOn: 'Jul 2, 2026',
      status: 'pending',
    },
    {
      id: 'app_declined',
      programId: 'prog_backstage',
      programName: 'Backstage: Accessibility Audit',
      termName: 'Summer 2026',
      submittedOn: 'Apr 9, 2026',
      status: 'declined',
    },
    {
      id: 'app_withdrawn',
      programId: 'prog_envoy',
      programName: 'Envoy: WASM Filters',
      termName: 'Spring 2026',
      submittedOn: 'Jan 12, 2026',
      status: 'withdrawn',
    },
    {
      id: 'app_graduated',
      programId: 'prog_k8s',
      programName: 'Kubernetes: Scheduling',
      termName: 'Fall 2025',
      submittedOn: 'Sep 3, 2025',
      status: 'graduated',
    },
    { id: 'app_hold', programId: 'prog_cncf', programName: 'CNCF: Storage Drivers', termName: 'Winter 2026', submittedOn: 'Feb 18, 2026', status: 'hold' },
  ];

  let fixture: ComponentFixture<ApplicationHistoryComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const setup = (data: MentorshipMenteeApplicationHistoryEntry[]): void => {
    fixture = TestBed.createComponent(ApplicationHistoryComponent);
    fixture.componentRef.setInput('entries', data);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [ApplicationHistoryComponent] });
  });

  it('renders the section title', () => {
    setup(entries);

    expect(element().querySelector('[data-testid="mentorship-application-history-title"]')?.textContent?.trim()).toBe('Application History');
  });

  it('renders one row per entry with the program name and term', () => {
    setup(entries);

    expect(element().querySelector('[data-testid="mentorship-application-history-name-app_accepted"]')?.textContent?.trim()).toBe(
      'GridFlow: Ingestion Pipeline'
    );
    expect(element().querySelector('[data-testid="mentorship-application-history-term-app_accepted"]')?.textContent?.trim()).toBe('Fall 2026');
    expect(element().querySelectorAll('[data-testid^="mentorship-application-history-row-"]').length).toBe(6);
  });

  it('lets the program name wrap freely so long upstream names never clip at narrow widths', () => {
    setup(entries);

    const nameEl = element().querySelector<HTMLElement>('[data-testid="mentorship-application-history-name-app_accepted"]');
    expect(nameEl?.className).not.toContain('truncate');
    expect(nameEl?.className).not.toContain('whitespace-nowrap');
  });

  it('paints the badge with the stored applications.status mapped to display copy', () => {
    setup(entries);

    const accepted = element().querySelector<HTMLElement>('[data-testid="mentorship-application-history-status-app_accepted"]');
    expect(accepted?.textContent?.trim()).toBe(MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS.accepted);
    for (const cls of MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES.accepted.split(' ')) {
      expect(accepted?.classList.contains(cls)).toBe(true);
    }

    const pending = element().querySelector<HTMLElement>('[data-testid="mentorship-application-history-status-app_pending"]');
    expect(pending?.textContent?.trim()).toBe(MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS.pending);

    const declined = element().querySelector<HTMLElement>('[data-testid="mentorship-application-history-status-app_declined"]');
    expect(declined?.textContent?.trim()).toBe(MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS.declined);

    const withdrawn = element().querySelector<HTMLElement>('[data-testid="mentorship-application-history-status-app_withdrawn"]');
    expect(withdrawn?.textContent?.trim()).toBe(MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS.withdrawn);

    const graduated = element().querySelector<HTMLElement>('[data-testid="mentorship-application-history-status-app_graduated"]');
    expect(graduated?.textContent?.trim()).toBe(MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS.graduated);

    const hold = element().querySelector<HTMLElement>('[data-testid="mentorship-application-history-status-app_hold"]');
    expect(hold?.textContent?.trim()).toBe(MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS.hold);
  });

  it('links View to the program page on the public Mentorship site in a new tab', () => {
    setup(entries);

    const view = element().querySelector<HTMLAnchorElement>('a[data-testid="mentorship-application-history-view-app_accepted"]');
    expect(view?.getAttribute('href')).toBe(`${MENTORSHIP_MENTEE_FIND_PROGRAM_URL}/prog_gridflow`);
    expect(view?.getAttribute('target')).toBe('_blank');
    expect(view?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('encodes the program id in the View link', () => {
    setup([{ ...entries[0], id: 'app_slash', programId: 'prog/with space' }]);

    const view = element().querySelector<HTMLAnchorElement>('[data-testid="mentorship-application-history-view-app_slash"]');
    expect(view?.getAttribute('href')).toBe(`${MENTORSHIP_MENTEE_FIND_PROGRAM_URL}/prog%2Fwith%20space`);
  });

  it('omits View when the row has no program id', () => {
    setup([{ ...entries[0], id: 'app_orphan', programId: '' }]);

    expect(element().querySelector('[data-testid="mentorship-application-history-view-app_orphan"]')).toBeNull();
  });

  it('offers withdraw only on pending applications — Mentorship has no hard delete', () => {
    setup(entries);

    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_pending"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_accepted"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_declined"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_withdrawn"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_graduated"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_hold"]')).toBeNull();
  });

  it('emits the application id when the mentee withdraws a pending application', () => {
    setup(entries);
    const withdrawn: string[] = [];
    fixture.componentInstance.withdraw.subscribe((id) => withdrawn.push(id));

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-application-history-withdraw-app_pending"]')?.click();

    expect(withdrawn).toEqual(['app_pending']);
  });

  it('disables Withdraw and marks the row busy while the parent withdraws it', () => {
    setup(entries);
    fixture.componentRef.setInput('withdrawingId', 'app_pending');
    fixture.detectChanges();

    const button = element().querySelector<HTMLButtonElement>('[data-testid="mentorship-application-history-withdraw-app_pending"]');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
  });

  it('shows the empty state when the mentee has no history', () => {
    setup([]);

    expect(element().querySelector('[data-testid="mentorship-application-history-list"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-empty"]')).not.toBeNull();
  });

  it('falls back to the raw status and a neutral badge when applications.status is unmapped', () => {
    setup([
      {
        id: 'app_unknown',
        programId: 'prog_unknown',
        programName: 'Unknown Status Program',
        termName: 'Fall 2026',
        submittedOn: 'Jul 2, 2026',
        status: 'unpublished' as MentorshipMenteeApplicationHistoryEntry['status'],
      },
    ]);

    const badge = element().querySelector<HTMLElement>('[data-testid="mentorship-application-history-status-app_unknown"]');
    expect(badge?.textContent?.trim()).toBe('unpublished');
    for (const cls of MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_UNKNOWN_BADGE_CLASS.split(' ')) {
      expect(badge?.classList.contains(cls)).toBe(true);
    }
    for (const cls of MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES.declined.split(' ')) {
      expect(badge?.classList.contains(cls)).toBe(false);
    }
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_unknown"]')).toBeNull();
  });
});
