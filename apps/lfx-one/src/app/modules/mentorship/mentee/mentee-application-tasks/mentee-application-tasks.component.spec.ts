// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MENTORSHIP_MENTEE_TASKS_EMPTY_TITLE, MENTORSHIP_MENTEE_TASKS_LOAD_ERROR } from '@lfx-one/shared/constants';
import { MentorshipMenteeApplication, MentorshipMenteeApplicationsResponse } from '@lfx-one/shared/interfaces';
import { MenteeTaskStatusService } from '@modules/mentorship/services/mentee-task-status.service';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { menteeServiceTestDouble, menteeTestApplication, menteeTestTask } from '@shared/testing/mentorship-mentee-test-data';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeApplicationTasksComponent } from './mentee-application-tasks.component';

describe('MenteeApplicationTasksComponent', () => {
  let fixture: ComponentFixture<MenteeApplicationTasksComponent>;
  let menteeService: ReturnType<typeof menteeServiceTestDouble>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string): Element | null => element().querySelector(`[data-testid="${id}"]`);

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const bootstrap = async (
    options: { applications?: MentorshipMenteeApplication[]; fail?: boolean; pending?: Subject<MentorshipMenteeApplicationsResponse> } = {}
  ): Promise<void> => {
    menteeService = menteeServiceTestDouble(options.applications ?? []);
    if (options.fail) {
      menteeService.getMenteeApplications.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    }
    if (options.pending) {
      menteeService.getMenteeApplications.mockReturnValue(options.pending.asObservable());
    }

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeApplicationTasksComponent],
      providers: [
        { provide: MentorshipMenteeService, useValue: menteeService },
        { provide: MentorshipComingSoonService, useValue: { notify: vi.fn() } },
        { provide: MenteeTaskStatusService, useValue: { changeStatus: vi.fn() } },
      ],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeApplicationTasksComponent);
    await settle();
  };

  const accepted = (): MentorshipMenteeApplication =>
    menteeTestApplication({
      id: 'accepted',
      programName: 'Accepted Program',
      upstreamStatus: 'accepted',
      tasks: [menteeTestTask({ id: 'accepted-task', category: 'non_prerequisite' })],
    });
  const pending = (): MentorshipMenteeApplication => menteeTestApplication({ id: 'pending', programName: 'Pending Program', tasks: [menteeTestTask()] });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the loading state until the applications read resolves', async () => {
    const read = new Subject<MentorshipMenteeApplicationsResponse>();
    await bootstrap({ pending: read });
    expect(element().querySelector('lfx-route-loading')).toBeTruthy();

    read.next({ data: [], total: 0 });
    read.complete();
    await settle();
    expect(element().querySelector('lfx-route-loading')).toBeNull();
  });

  it('shows the error state and re-reads on Retry', async () => {
    await bootstrap({ fail: true });
    expect(byTestId('mentee-tasks-error')?.textContent).toContain(MENTORSHIP_MENTEE_TASKS_LOAD_ERROR);

    menteeService.getMenteeApplications.mockReturnValue(of({ data: [pending()], total: 1 }));
    Array.from(element().querySelectorAll('button'))
      .find((btn) => btn.textContent?.trim() === 'Retry')
      ?.click();
    await settle();

    expect(menteeService.clearMenteeCaches).toHaveBeenCalledTimes(1);
    expect(byTestId('mentee-tasks-error')).toBeNull();
    expect(byTestId('mentee-tasks')).toBeTruthy();
  });

  it('shows the loader again on Retry after an error', async () => {
    await bootstrap({ fail: true });
    const reread = new Subject<MentorshipMenteeApplicationsResponse>();
    menteeService.getMenteeApplications.mockReturnValue(reread.asObservable());

    Array.from(element().querySelectorAll('button'))
      .find((btn) => btn.textContent?.trim() === 'Retry')
      ?.click();
    await settle();

    expect(element().querySelector('lfx-route-loading')).toBeTruthy();
    expect(byTestId('mentee-tasks-error')).toBeNull();
  });

  it('keeps the tasks mounted, with no loader, while a refresh after a saved change is in flight', async () => {
    await bootstrap({ applications: [accepted()] });
    const tasks = byTestId('mentee-tasks');
    expect(tasks).toBeTruthy();

    const reread = new Subject<MentorshipMenteeApplicationsResponse>();
    menteeService.getMenteeApplications.mockReturnValue(reread.asObservable());
    menteeService.clearMenteeCaches();
    await settle();

    expect(element().querySelector('lfx-route-loading')).toBeNull();
    expect(byTestId('mentee-tasks')).toBe(tasks);

    reread.next({ data: [accepted()], total: 1 });
    reread.complete();
    await settle();
    expect(byTestId('mentee-tasks')).toBe(tasks);
  });

  it('shows the empty state when there are no applications', async () => {
    await bootstrap();
    expect(byTestId('mentee-tasks-empty')?.textContent).toContain(MENTORSHIP_MENTEE_TASKS_EMPTY_TITLE);
    expect(byTestId('mentee-tasks')).toBeNull();
  });

  it('shows the empty state when only past applications exist', async () => {
    await bootstrap({ applications: [menteeTestApplication({ upstreamStatus: 'declined' }), menteeTestApplication({ id: 'app-2', upstreamStatus: 'hold' })] });
    expect(byTestId('mentee-tasks-empty')).toBeTruthy();
  });

  it('renders the accepted application above the pending applications', async () => {
    await bootstrap({ applications: [pending(), accepted()] });
    const container = byTestId('mentee-tasks');
    const sections = Array.from(container?.children ?? []).map((child) => child.tagName.toLowerCase());
    expect(sections).toEqual(['lfx-mentee-accepted-tasks', 'lfx-mentee-applicant-tasks']);
    expect(byTestId('mentee-tasks-accepted-card-accepted')).toBeTruthy();
    expect(byTestId('mentee-tasks-application-card-pending')).toBeTruthy();
    expect(byTestId('mentee-tasks-application-card-accepted')).toBeNull();
  });

  it('renders only the accepted section for an accepted-only mentee', async () => {
    await bootstrap({ applications: [accepted()] });
    expect(byTestId('mentee-tasks-accepted')).toBeTruthy();
    expect(byTestId('mentee-tasks-applicant')).toBeNull();
  });

  it('renders a graduated application in the accepted section', async () => {
    await bootstrap({ applications: [pending(), menteeTestApplication({ ...accepted(), id: 'graduated', upstreamStatus: 'graduated' })] });
    expect(byTestId('mentee-tasks-accepted-card-graduated')).toBeTruthy();
    expect(byTestId('mentee-tasks-application-card-graduated')).toBeNull();
    expect(byTestId('mentee-tasks-application-card-pending')).toBeTruthy();
  });

  it('renders only the pending section when no application is accepted', async () => {
    await bootstrap({ applications: [pending()] });
    expect(byTestId('mentee-tasks-accepted')).toBeNull();
    expect(byTestId('mentee-tasks-applicant')).toBeTruthy();
  });
});
