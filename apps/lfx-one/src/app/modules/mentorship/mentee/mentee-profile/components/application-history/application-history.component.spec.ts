// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MENTORSHIP_COMING_SOON_DETAIL,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS,
  MENTORSHIP_MENTEE_APPLICATION_HISTORY_WITHDRAW_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeApplicationHistoryEntry } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationHistoryComponent } from './application-history.component';

describe('ApplicationHistoryComponent', () => {
  const entries: MentorshipMenteeApplicationHistoryEntry[] = [
    { id: 'app_accepted', programName: 'GridFlow: Ingestion Pipeline', termName: 'Fall 2026', submittedOn: 'Jun 28, 2026', status: 'accepted' },
    { id: 'app_pending', programName: 'Apicurio Registry: Playground', termName: 'Fall 2026', submittedOn: 'Jul 2, 2026', status: 'pending' },
    { id: 'app_declined', programName: 'Backstage: Accessibility Audit', termName: 'Summer 2026', submittedOn: 'Apr 9, 2026', status: 'declined' },
    { id: 'app_withdrawn', programName: 'Envoy: WASM Filters', termName: 'Spring 2026', submittedOn: 'Jan 12, 2026', status: 'withdrawn' },
    { id: 'app_graduated', programName: 'Kubernetes: Scheduling', termName: 'Fall 2025', submittedOn: 'Sep 3, 2025', status: 'graduated' },
    { id: 'app_hold', programName: 'CNCF: Storage Drivers', termName: 'Winter 2026', submittedOn: 'Feb 18, 2026', status: 'hold' },
  ];

  let fixture: ComponentFixture<ApplicationHistoryComponent>;
  let messageAdd: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const setup = (data: MentorshipMenteeApplicationHistoryEntry[]): void => {
    fixture = TestBed.createComponent(ApplicationHistoryComponent);
    fixture.componentRef.setInput('entries', data);
    fixture.detectChanges();
  };

  beforeEach(() => {
    messageAdd = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ApplicationHistoryComponent],
      providers: [{ provide: MessageService, useValue: { add: messageAdd } }],
    });
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

  it('offers withdraw only on pending applications — Mentorship has no hard delete', () => {
    setup(entries);

    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_pending"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_accepted"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_declined"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_withdrawn"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_graduated"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_hold"]')).toBeNull();
  });

  it('fires the coming-soon toast when the mentee withdraws a pending application', () => {
    setup(entries);

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-application-history-withdraw-app_pending"]')?.click();

    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        summary: MENTORSHIP_MENTEE_APPLICATION_HISTORY_WITHDRAW_LABEL,
        detail: MENTORSHIP_COMING_SOON_DETAIL,
      })
    );
  });

  it('shows the empty state when the mentee has no history', () => {
    setup([]);

    expect(element().querySelector('[data-testid="mentorship-application-history-list"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history-empty"]')).not.toBeNull();
  });

  it('falls back to the raw status and the declined badge when applications.status is unmapped', () => {
    setup([
      {
        id: 'app_unknown',
        programName: 'Unknown Status Program',
        termName: 'Fall 2026',
        submittedOn: 'Jul 2, 2026',
        status: 'unpublished' as MentorshipMenteeApplicationHistoryEntry['status'],
      },
    ]);

    const badge = element().querySelector<HTMLElement>('[data-testid="mentorship-application-history-status-app_unknown"]');
    expect(badge?.textContent?.trim()).toBe('unpublished');
    for (const cls of MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES.declined.split(' ')) {
      expect(badge?.classList.contains(cls)).toBe(true);
    }
    expect(element().querySelector('[data-testid="mentorship-application-history-withdraw-app_unknown"]')).toBeNull();
  });
});
