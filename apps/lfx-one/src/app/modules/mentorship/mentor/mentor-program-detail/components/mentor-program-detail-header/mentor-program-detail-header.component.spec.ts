// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_BADGE_CLASSES, MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipMentorProgram, MentorshipMentorProgramDetailTab, MentorshipMentorProgramTermStatus } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MentorProgramDetailHeaderComponent } from './mentor-program-detail-header.component';

describe('MentorProgramDetailHeaderComponent', () => {
  const program = (overrides: Partial<MentorshipMentorProgram> = {}): MentorshipMentorProgram => ({
    id: 'mp_gridflow_fall26',
    slug: 'gridflow-time-series-ingestion-pipeline',
    name: 'GridFlow: Ingestion Pipeline',
    projectName: 'LF Energy',
    term: 'Fall 2026',
    termStatus: 'active-term',
    stats: { mentees: 2, applicants: 1, tasksToReview: 3 },
    termStartDate: '2026-09-01',
    termEndDate: '2026-12-15',
    ...overrides,
  });

  let fixture: ComponentFixture<MentorProgramDetailHeaderComponent>;

  const render = (
    overrides: {
      program?: Partial<MentorshipMentorProgram>;
      tabCounts?: { tasks: number; mentees: number; applicants: number };
      activeTab?: MentorshipMentorProgramDetailTab;
    } = {}
  ): void => {
    fixture = TestBed.createComponent(MentorProgramDetailHeaderComponent);
    fixture.componentRef.setInput('program', program(overrides.program));
    fixture.componentRef.setInput('tabCounts', overrides.tabCounts ?? { tasks: 3, mentees: 1, applicants: 1 });
    fixture.componentRef.setInput('activeTab', overrides.activeTab ?? 'applicants');
    fixture.detectChanges();
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const tab = (value: MentorshipMentorProgramDetailTab): HTMLButtonElement | null =>
    element().querySelector<HTMLButtonElement>(`[data-testid="mentorship-mentor-program-detail-tab-${value}"]`);

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramDetailHeaderComponent],
      providers: [provideNoopAnimations()],
    });
  });

  it('renders the program name in the H1', () => {
    render();
    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-title"]')?.textContent?.trim()).toBe('GridFlow: Ingestion Pipeline');
  });

  it('builds the season line from projectName, term, and the formatted date range', () => {
    render();
    const season = element().querySelector('[data-testid="mentorship-mentor-program-detail-season"]')?.textContent?.trim() ?? '';
    // Bounded assertions rather than an exact match — the formatted range comes from a
    // shared util whose exact format string isn't the header's contract.
    expect(season).toContain('LF Energy');
    expect(season).toContain('Fall 2026');
    expect(season.split('·').length).toBe(3);
  });

  it('drops the date range from the season line when either bound is missing', () => {
    // The header must not render "· undefined" or a partial range if only one bound is set.
    render({ program: { termStartDate: undefined, termEndDate: undefined } });
    const season = element().querySelector('[data-testid="mentorship-mentor-program-detail-season"]')?.textContent?.trim() ?? '';
    expect(season).toBe('LF Energy · Fall 2026');
  });

  it.each<MentorshipMentorProgramTermStatus>(['active-term', 'upcoming', 'completed'])(
    'renders the term-status badge with the shared label and class for %s',
    (termStatus) => {
      render({ program: { termStatus } });
      const badge = element().querySelector('[data-testid="mentorship-mentor-program-detail-status"]');
      expect(badge?.textContent?.trim()).toBe(MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS[termStatus]);
      // The badge classes come from a shared map safelisted in tailwind.config.js — verify
      // the exact string binding to lock the map/template wiring, not the visual output.
      for (const cls of MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_BADGE_CLASSES[termStatus].split(' ')) {
        expect(badge?.classList.contains(cls)).toBe(true);
      }
    }
  );

  it('renders every tab with its count and marks the active tab aria-selected', () => {
    render({ activeTab: 'applicants', tabCounts: { tasks: 3, mentees: 1, applicants: 1 } });

    expect(tab('tasks')?.textContent).toContain('Tasks');
    expect(tab('tasks')?.textContent).toContain('3');
    expect(tab('mentees')?.textContent).toContain('1');
    expect(tab('applicants')?.getAttribute('aria-selected')).toBe('true');
    expect(tab('applicants')?.getAttribute('tabindex')).toBe('0');
    expect(tab('tasks')?.getAttribute('aria-selected')).toBe('false');
    expect(tab('tasks')?.getAttribute('tabindex')).toBe('-1');
  });

  it('emits tabChange when a tab is clicked', () => {
    render();
    const events: MentorshipMentorProgramDetailTab[] = [];
    fixture.componentInstance.tabChange.subscribe((value) => events.push(value));

    tab('mentees')?.click();

    expect(events).toEqual(['mentees']);
  });

  it('cycles forward with ArrowRight and wraps at the end', () => {
    render({ activeTab: 'applicants' });
    const events: MentorshipMentorProgramDetailTab[] = [];
    fixture.componentInstance.tabChange.subscribe((value) => events.push(value));

    const tablist = element().querySelector('[data-testid="mentorship-mentor-program-detail-tabs"]') as HTMLElement;
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    tablist.dispatchEvent(event);

    // Applicants is the last tab, so ArrowRight wraps to the first (Tasks).
    expect(event.defaultPrevented).toBe(true);
    expect(events).toEqual(['tasks']);
  });

  it('cycles backward with ArrowLeft and wraps at the start', () => {
    render({ activeTab: 'tasks' });
    const events: MentorshipMentorProgramDetailTab[] = [];
    fixture.componentInstance.tabChange.subscribe((value) => events.push(value));

    const tablist = element().querySelector('[data-testid="mentorship-mentor-program-detail-tabs"]') as HTMLElement;
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));

    // Tasks is first, so ArrowLeft wraps to the last (Applicants).
    expect(events).toEqual(['applicants']);
  });

  it('jumps to the last tab with End and the first with Home', () => {
    render({ activeTab: 'mentees' });
    const events: MentorshipMentorProgramDetailTab[] = [];
    fixture.componentInstance.tabChange.subscribe((value) => events.push(value));

    const tablist = element().querySelector('[data-testid="mentorship-mentor-program-detail-tabs"]') as HTMLElement;
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));

    expect(events).toEqual(['applicants', 'tasks']);
  });

  it('ignores unhandled keys so typing does not shift focus or emit a change', () => {
    render();
    const events: MentorshipMentorProgramDetailTab[] = [];
    fixture.componentInstance.tabChange.subscribe((value) => events.push(value));

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    (element().querySelector('[data-testid="mentorship-mentor-program-detail-tabs"]') as HTMLElement).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(events).toEqual([]);
  });
});
