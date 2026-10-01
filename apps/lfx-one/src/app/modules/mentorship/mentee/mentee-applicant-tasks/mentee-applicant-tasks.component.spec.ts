// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MENTORSHIP_MENTEE_TASKS_APPLICATION_EMPTY } from '@lfx-one/shared/constants';
import { MentorshipMenteeApplication } from '@lfx-one/shared/interfaces';
import { MenteeTaskStatusService } from '@modules/mentorship/services/mentee-task-status.service';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { menteeTestApplication, menteeTestCards, menteeTestTask } from '@shared/testing/mentorship-mentee-test-data';
import { describe, expect, it, vi } from 'vitest';

import { MenteeApplicantTasksComponent } from './mentee-applicant-tasks.component';

describe('MenteeApplicantTasksComponent', () => {
  let fixture: ComponentFixture<MenteeApplicantTasksComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string): Element | null => element().querySelector(`[data-testid="${id}"]`);
  const text = (el: Element | null | undefined): string => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  const bootstrap = async (applications: MentorshipMenteeApplication[]): Promise<void> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeApplicantTasksComponent],
      providers: [
        { provide: MentorshipComingSoonService, useValue: { notify: vi.fn() } },
        { provide: MenteeTaskStatusService, useValue: { changeStatus: vi.fn() } },
      ],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeApplicantTasksComponent);
    fixture.componentRef.setInput('applications', menteeTestCards(applications));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('numbers each application card', async () => {
    await bootstrap([menteeTestApplication({ tasks: [menteeTestTask()] }), menteeTestApplication({ id: 'app-2', tasks: [menteeTestTask({ id: 'task-2' })] })]);
    const labels = Array.from(element().querySelectorAll('p.uppercase'))
      .map((el) => text(el))
      .filter((label) => label.startsWith('Application'));
    expect(labels).toEqual(['Application 1 of 2', 'Application 2 of 2']);
  });

  it('renders the card header with the program, status badge and submitted count', async () => {
    await bootstrap([menteeTestApplication({ tasks: [menteeTestTask({ status: 'submitted' }), menteeTestTask({ id: 'task-2' })] })]);
    const card = text(byTestId('mentee-tasks-application-card-app-1'));
    expect(card).toContain('Program One');
    expect(card).toContain('In Progress');
    expect(card).toContain('Project One · Fall 2026 · 1 of 2 submitted');
  });

  it('drops the project from the header when the program has none', async () => {
    await bootstrap([menteeTestApplication({ projectName: undefined, tasks: [menteeTestTask()] })]);
    const card = text(byTestId('mentee-tasks-application-card-app-1'));
    expect(card).not.toContain('Project One');
    expect(card).toContain('Fall 2026 · 0 of 1 submitted');
  });

  it('renders a row per prerequisite task', async () => {
    await bootstrap([
      menteeTestApplication({
        tasks: [menteeTestTask(), menteeTestTask({ id: 'task-2' }), menteeTestTask({ id: 'task-3', category: 'non_prerequisite' })],
      }),
    ]);
    expect(byTestId('mentee-tasks-task-row-task-1')).toBeTruthy();
    expect(byTestId('mentee-tasks-task-row-task-2')).toBeTruthy();
    expect(byTestId('mentee-tasks-task-row-task-3')).toBeNull();
  });

  it('shows the per-application empty text when the application has no prerequisite tasks', async () => {
    await bootstrap([menteeTestApplication({ tasks: [] })]);
    expect(text(byTestId('mentee-tasks-application-empty-app-1'))).toBe(MENTORSHIP_MENTEE_TASKS_APPLICATION_EMPTY);
    expect(text(byTestId('mentee-tasks-application-card-app-1'))).toContain('Awaiting Review');
  });
});
