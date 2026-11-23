// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Stubs for View on a submitted task file (linuxfoundation/lfx-mentorship#400, covered under #378). Every View reads
 * `GET /api/mentorship/tasks/:taskId/file`, opens a tab before the read lands, then shows a PDF or text file there from
 * a `blob:` URL, or closes the tab and downloads any other type. The type comes from the answer's Content-Type, or from
 * the file name when that is generic. Data is synthetic, and the stub records which task each read was for.
 */

import { MentorshipMentorProgramDetail } from '@lfx-one/shared/interfaces';
import { Page } from '@playwright/test';

import { MENTOR_PROGRAMS_URL } from './mentor-profile.helper';

export const VIEW_TEXT_BODY = 'Synthetic submission text.';

/** How the file read answers: a status, and for a 200 the Content-Type and file name the BFF relays. */
export interface TaskFileAnswer {
  status?: number;
  contentType?: string;
  fileName?: string;
}

/** Answers every task file read with `answer` (a PDF by default) and returns the task ids read. */
export async function stubTaskFile(page: Page, answer: TaskFileAnswer = {}): Promise<string[]> {
  const taskIds: string[] = [];
  const { status = 200, contentType = 'application/pdf', fileName = 'submission.pdf' } = answer;
  await page.route('**/api/mentorship/tasks/*/file', (route) => {
    taskIds.push(decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2) ?? ''));
    if (status !== 200) return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'stubbed' }) });
    // A PDF needs only its signature for the viewer to take the blob; a text file shows its body.
    const body = contentType.startsWith('text/') || fileName.endsWith('.txt') ? VIEW_TEXT_BODY : '%PDF-1.4\n%%EOF\n';
    return route.fulfill({ status, headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"` }, body });
  });
  return taskIds;
}

export const MENTOR_VIEW_PROGRAM_ID = 'd0e2e400-0000-4000-8000-000000000001';
export const MENTOR_VIEW_MENTEE_ID = 'd0e2e400-0000-4000-8000-000000000002';
export const MENTOR_VIEW_TASK_ID = 'd0e2e400-0000-4000-8000-000000000003';
export const MENTOR_VIEW_ROW_ID = `${MENTOR_VIEW_MENTEE_ID}__${MENTOR_VIEW_TASK_ID}`;
export const MENTOR_VIEW_URL = `${MENTOR_PROGRAMS_URL}/${MENTOR_VIEW_PROGRAM_ID}`;

/** One accepted mentee with one submitted task, which has a file when `hasSubmission` is set. */
export function mentorViewDetail(hasSubmission = true): MentorshipMentorProgramDetail {
  return {
    program: {
      id: MENTOR_VIEW_PROGRAM_ID,
      slug: 'test-program-view',
      name: 'Test Program View',
      projectName: 'Test Project',
      status: 'accepting',
      stats: { mentees: 1, tasksToReview: 1, applicants: 0 },
    },
    tabCounts: { tasks: 1, mentees: 1, applicants: 0 },
    mentees: [
      {
        id: MENTOR_VIEW_MENTEE_ID,
        name: 'Test Mentee Viewer',
        email: 'test.mentee.viewer@example.com',
        status: 'accepted',
        termName: 'Test Term Fall',
        tasksSubmitted: 1,
        tasksTotal: 1,
        tasks: [
          {
            id: MENTOR_VIEW_TASK_ID,
            name: 'Test Design Doc',
            description: 'One page on the plan.',
            status: 'submitted',
            prerequisite: false,
            createdOn: '2026-09-20',
            updatedOn: '2026-10-01',
            hasSubmission,
          },
        ],
      },
    ],
    applicants: [],
  };
}

export async function stubMentorViewDetail(page: Page, hasSubmission = true): Promise<void> {
  await page.route(`**/api/mentorship/mentor/programs/${MENTOR_VIEW_PROGRAM_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mentorViewDetail(hasSubmission)) })
  );
}

/**
 * Records the type of every `blob:` URL the page makes, so a spec can tell a PDF was handed to the tab (re-typed to
 * `application/pdf`) even in headless Chromium, whose tab has no PDF viewer and so never shows the blob. Call it
 * before the first navigation.
 */
export async function recordBlobTypes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const created: string[] = [];
    (window as unknown as { __e2eBlobTypes: string[] }).__e2eBlobTypes = created;
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) created.push(object.type);
      return original(object);
    };
  });
}

/** The types `recordBlobTypes` saw, in order. */
export const blobTypes = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __e2eBlobTypes?: string[] }).__e2eBlobTypes ?? []);
