// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MentorshipMenteeApplicationTask, MentorshipUpstreamApplicationStatus } from '@lfx-one/shared/interfaces';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { menteeTestApplication, menteeTestCards, menteeTestTask } from '@shared/testing/mentorship-mentee-test-data';
import { describe, expect, it, vi } from 'vitest';

import { MenteeAcceptedTasksComponent } from './mentee-accepted-tasks.component';

describe('MenteeAcceptedTasksComponent', () => {
  let fixture: ComponentFixture<MenteeAcceptedTasksComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string): Element | null => element().querySelector(`[data-testid="${id}"]`);
  const text = (el: Element | null | undefined): string => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const rowIds = (): string[] =>
    Array.from(element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]')).map((row) => row.getAttribute('data-testid') ?? '');
  const chip = (value: string): HTMLButtonElement => byTestId(`mentee-tasks-filter-${value}`) as HTMLButtonElement;

  const bootstrap = async (
    tasks: MentorshipMenteeApplicationTask[],
    overrides: { projectName?: string; upstreamStatus?: MentorshipUpstreamApplicationStatus } = { projectName: 'Project One' }
  ): Promise<void> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeAcceptedTasksComponent],
      providers: [{ provide: MentorshipComingSoonService, useValue: { notify: vi.fn() } }],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeAcceptedTasksComponent);
    const [card] = menteeTestCards([
      menteeTestApplication({ upstreamStatus: overrides.upstreamStatus ?? 'accepted', projectName: overrides.projectName, tasks }),
    ]);
    fixture.componentRef.setInput('application', card);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const clickChip = async (value: string): Promise<void> => {
    chip(value).click();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const mixedTasks = (): MentorshipMenteeApplicationTask[] => [
    menteeTestTask({ id: 'prereq', category: 'prerequisite', status: 'complete' }),
    menteeTestTask({ id: 'todo', category: 'non_prerequisite', status: 'incomplete' }),
    menteeTestTask({ id: 'doing', category: 'non_prerequisite', status: 'in_progress' }),
    menteeTestTask({ id: 'done', category: 'non_prerequisite', status: 'complete' }),
    menteeTestTask({ id: 'uploaded', category: 'non_prerequisite', status: 'submitted' }),
  ];

  it('renders the program card with the Active badge and project context', async () => {
    await bootstrap(mixedTasks());
    const card = text(byTestId('mentee-tasks-accepted-card-app-1'));
    expect(card).toContain('Program One');
    expect(card).toContain('Project One · Fall 2026');
    expect(card).toContain('Active');
    expect(byTestId('mentee-tasks-accepted-status')?.classList).toContain('bg-blue-50');
  });

  it('renders the Graduated badge in its own colour for a graduated application', async () => {
    await bootstrap(mixedTasks(), { projectName: 'Project One', upstreamStatus: 'graduated' });
    const badge = byTestId('mentee-tasks-accepted-status');
    expect(text(badge)).toBe('Graduated');
    expect(badge?.classList).toContain('bg-violet-50');
    expect(badge?.classList).not.toContain('bg-blue-50');
  });

  it('drops the project from the card when the program has none', async () => {
    await bootstrap(mixedTasks(), { projectName: undefined });
    const card = text(byTestId('mentee-tasks-accepted-card-app-1'));
    expect(card).not.toContain('Project One');
    expect(card).toContain('Fall 2026');
  });

  it('summarises progress over the non-prerequisite tasks only', async () => {
    await bootstrap(mixedTasks());
    expect(text(byTestId('mentee-tasks-submitted-summary'))).toBe('50% · 2 of 4 submitted');
    expect(element().querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
  });

  it('lists every non-prerequisite task and leaves out prerequisites', async () => {
    await bootstrap(mixedTasks());
    expect(rowIds()).toEqual(['mentee-tasks-task-row-todo', 'mentee-tasks-task-row-doing', 'mentee-tasks-task-row-done', 'mentee-tasks-task-row-uploaded']);
  });

  it('renders the filter chips with All pressed by default', async () => {
    await bootstrap(mixedTasks());
    const chips = Array.from(byTestId('mentee-tasks-filter-chips')?.querySelectorAll('button') ?? []);
    expect(chips.map((btn) => text(btn))).toEqual(['All', 'To Do', 'In Progress', 'Submitted']);
    expect(chip('all').getAttribute('aria-pressed')).toBe('true');
    expect(chip('pending').getAttribute('aria-pressed')).toBe('false');
  });

  it('filters the rows by the selected chip and updates aria-pressed', async () => {
    await bootstrap(mixedTasks());

    await clickChip('pending');
    expect(rowIds()).toEqual(['mentee-tasks-task-row-todo']);
    expect(chip('pending').getAttribute('aria-pressed')).toBe('true');
    expect(chip('all').getAttribute('aria-pressed')).toBe('false');

    await clickChip('submitted');
    expect(rowIds()).toEqual(['mentee-tasks-task-row-done', 'mentee-tasks-task-row-uploaded']);

    await clickChip('all');
    expect(rowIds()).toHaveLength(4);
  });

  it('shows the empty-filter text when no task matches the selected chip', async () => {
    await bootstrap([menteeTestTask({ id: 'todo', category: 'non_prerequisite' })]);
    await clickChip('submitted');
    expect(byTestId('mentee-tasks-accepted-empty-filter')).toBeTruthy();
    expect(byTestId('mentee-tasks-accepted-empty-all')).toBeNull();
  });

  it('shows the no-tasks text when the application has no non-prerequisite tasks', async () => {
    await bootstrap([menteeTestTask({ id: 'prereq', category: 'prerequisite', status: 'complete' })]);
    expect(byTestId('mentee-tasks-accepted-empty-all')).toBeTruthy();
    expect(byTestId('mentee-tasks-accepted-empty-filter')).toBeNull();
    expect(text(byTestId('mentee-tasks-submitted-summary'))).toBe('0% · 0 of 0 submitted');
  });
});
