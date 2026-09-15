// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MENTORSHIP_MENTORING_HISTORY_STATUS_BADGE_CLASSES, MENTORSHIP_MENTORING_HISTORY_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipMentoringHistoryEntry } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MentoringHistoryComponent } from './mentoring-history.component';

describe('MentoringHistoryComponent', () => {
  const entries: MentorshipMentoringHistoryEntry[] = [
    { id: 'mh_active', programName: 'GridFlow: Ingestion Pipeline', term: 'Fall 2026', menteesCount: 3, status: 'in-progress' },
    { id: 'mh_single', programName: 'GridFlow: Metrics Exporter', term: 'Spring 2026', menteesCount: 1, status: 'completed' },
  ];

  let fixture: ComponentFixture<MentoringHistoryComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const setup = (data: MentorshipMentoringHistoryEntry[]): void => {
    fixture = TestBed.createComponent(MentoringHistoryComponent);
    fixture.componentRef.setInput('entries', data);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [MentoringHistoryComponent] });
  });

  it('renders the section title', () => {
    setup(entries);

    expect(element().querySelector('[data-testid="mentorship-mentoring-history-title"]')?.textContent?.trim()).toBe('Mentoring History');
  });

  it('renders one row per entry with the program name and term', () => {
    setup(entries);

    expect(element().querySelector('[data-testid="mentorship-mentoring-history-name-mh_active"]')?.textContent?.trim()).toBe('GridFlow: Ingestion Pipeline');
    expect(element().querySelector('[data-testid="mentorship-mentoring-history-term-mh_active"]')?.textContent?.trim()).toBe('Fall 2026');
    expect(element().querySelectorAll('[data-testid^="mentorship-mentoring-history-row-"]').length).toBe(2);
  });

  it('lets the program name wrap freely so long upstream names never clip at narrow widths', () => {
    // The KB pattern `templates-and-accessibility/no-wrap-truncates-dynamic-label` calls out
    // dynamic labels forced onto a single line; the row's programName span has neither
    // `truncate` nor `whitespace-nowrap`, so this assertion locks that in.
    setup(entries);

    const nameEl = element().querySelector<HTMLElement>('[data-testid="mentorship-mentoring-history-name-mh_active"]');
    expect(nameEl?.className).not.toContain('truncate');
    expect(nameEl?.className).not.toContain('whitespace-nowrap');
  });

  it('pluralizes the mentee count so a single mentee reads "1 mentee"', () => {
    setup(entries);

    expect(element().querySelector('[data-testid="mentorship-mentoring-history-mentees-mh_active"]')?.textContent?.trim()).toBe('3 mentees');
    expect(element().querySelector('[data-testid="mentorship-mentoring-history-mentees-mh_single"]')?.textContent?.trim()).toBe('1 mentee');
  });

  it('paints the badge with the shared status label and class map', () => {
    setup(entries);

    const inProgress = element().querySelector<HTMLElement>('[data-testid="mentorship-mentoring-history-status-mh_active"]');
    expect(inProgress?.textContent?.trim()).toBe(MENTORSHIP_MENTORING_HISTORY_STATUS_LABELS['in-progress']);
    for (const cls of MENTORSHIP_MENTORING_HISTORY_STATUS_BADGE_CLASSES['in-progress'].split(' ')) {
      expect(inProgress?.classList.contains(cls)).toBe(true);
    }

    const completed = element().querySelector<HTMLElement>('[data-testid="mentorship-mentoring-history-status-mh_single"]');
    expect(completed?.textContent?.trim()).toBe(MENTORSHIP_MENTORING_HISTORY_STATUS_LABELS.completed);
    for (const cls of MENTORSHIP_MENTORING_HISTORY_STATUS_BADGE_CLASSES.completed.split(' ')) {
      expect(completed?.classList.contains(cls)).toBe(true);
    }
  });

  it('shows the empty state when the mentor has no history', () => {
    setup([]);

    expect(element().querySelector('[data-testid="mentorship-mentoring-history-list"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentoring-history-empty"]')).not.toBeNull();
  });
});
