// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import {
  MentorshipMenteeApplication,
  MentorshipMenteeApplicationsResponse,
  MentorshipMenteeApplicationTask,
  MentorshipMenteeApplicationView,
} from '@lfx-one/shared/interfaces';
import { buildMentorshipMenteeOverview } from '@lfx-one/shared/utils';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';

/** A synthetic mentee application task; override any field per test. */
export function menteeTestTask(overrides: Partial<MentorshipMenteeApplicationTask> = {}): MentorshipMenteeApplicationTask {
  return {
    id: 'task-1',
    name: 'Task 1',
    description: 'Synthetic task',
    category: 'prerequisite',
    status: 'incomplete',
    submitFile: null,
    updatedOn: '2026-07-01T10:00:00Z',
    ...overrides,
  };
}

/** A synthetic pending mentee application with no tasks; override any field per test. */
export function menteeTestApplication(overrides: Partial<MentorshipMenteeApplication> = {}): MentorshipMenteeApplication {
  return {
    id: 'app-1',
    programId: 'prog-1',
    programName: 'Program One',
    projectName: 'Project One',
    term: { id: 'term-1', name: 'Fall 2026' },
    upstreamStatus: 'pending',
    createdOn: '2026-06-01T10:00:00Z',
    updatedOn: '2026-06-02T10:00:00Z',
    decisionExpectedDate: '2026-08-01T00:00:00Z',
    tasks: [],
    ...overrides,
  };
}

/** The display cards `buildMentorshipMenteeOverview` derives from synthetic applications. */
export function menteeTestCards(applications: MentorshipMenteeApplication[]): MentorshipMenteeApplicationView[] {
  return buildMentorshipMenteeOverview(applications).cards;
}

/**
 * Build a `MentorshipMenteeService` double covering the applications read and its revision signal.
 * `clearMenteeCaches` bumps the revision like the real service, so a Retry makes readers fetch again.
 */
export function menteeServiceTestDouble(applications: MentorshipMenteeApplication[] = []) {
  const revision = signal(0);
  return {
    menteeApplicationsRevision: revision.asReadonly(),
    getMenteeApplications: vi.fn((): Observable<MentorshipMenteeApplicationsResponse> => of({ data: applications, total: applications.length })),
    clearMenteeCaches: vi.fn(() => revision.update((value) => value + 1)),
  };
}
