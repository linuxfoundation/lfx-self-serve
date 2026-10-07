// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Stubs for the admin Mentors tab writes (linuxfoundation/lfx-mentorship#238): a stateful mentors read plus the
 * `PATCH …/mentors/:id` status change. The stub keeps the mentors in memory and applies each accepted status, so
 * the page read that follows a write shows the change. All data is synthetic.
 */

import { MentorshipAdminMentorsResponse, MentorshipProgramMentor } from '@lfx-one/shared/interfaces';
import { Page, Route } from '@playwright/test';

import { ADMIN_PROGRAM_ID, adminMentorId } from './mentorship-admin-program.helper';

const MENTORS_ROUTE = `**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/mentors*`;
const MENTOR_WRITE_ROUTE = `**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/mentors/*`;

/** One mentor per status that offers an action, plus one that offers none. Ids are `adminMentorId(n)`. */
export const MENTOR_ACTION_MENTORS: MentorshipProgramMentor[] = [
  { name: 'Test Mentor Requested', status: 'requested' },
  { name: 'Test Mentor Requested Again', status: 'requested' },
  { name: 'Test Mentor Invited', status: 'invited' },
  { name: 'Test Mentor Active', status: 'active' },
  { name: 'Test Mentor Declined', status: 'declined' },
].map(({ name, status }, index) => ({
  id: adminMentorId(index + 1),
  name,
  email: `test.mentor.${index + 1}@example.com`,
  status: status as MentorshipProgramMentor['status'],
  invitedOn: '2026-03-04',
  profileCreated: status === 'active',
}));

export const MENTOR_REQUESTED_ID = MENTOR_ACTION_MENTORS[0].id;
export const MENTOR_REQUESTED_AGAIN_ID = MENTOR_ACTION_MENTORS[1].id;
export const MENTOR_INVITED_ID = MENTOR_ACTION_MENTORS[2].id;
export const MENTOR_ACTIVE_ID = MENTOR_ACTION_MENTORS[3].id;
export const MENTOR_DECLINED_ID = MENTOR_ACTION_MENTORS[4].id;

export interface MentorWriteRecord {
  id: string;
  method: string;
  body: Record<string, unknown>;
}

export interface MentorStubState {
  /** The mentors the read answers with; a 204 write changes the matching one's status. */
  mentors: MentorshipProgramMentor[];
  /** Every write received, in order. */
  writes: MentorWriteRecord[];
  /** Number of mentors reads answered. */
  reads: number;
}

export const newMentorStubState = (): MentorStubState => ({ mentors: MENTOR_ACTION_MENTORS.map((mentor) => ({ ...mentor })), writes: [], reads: 0 });

const fulfillJson = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Answers the mentors read from `state.mentors`, and the status write with `writeStatus` (204 applies the change). */
export async function stubMentorActions(page: Page, state: MentorStubState, writeStatus = 204): Promise<void> {
  await page.route(MENTORS_ROUTE, (route) => {
    state.reads += 1;
    return fulfillJson(route, 200, { data: state.mentors, total: state.mentors.length } satisfies MentorshipAdminMentorsResponse);
  });
  await page.route(MENTOR_WRITE_ROUTE, (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').pop() ?? '';
    const body = request.postDataJSON() as Record<string, unknown>;
    state.writes.push({ id, method: request.method(), body });
    if (writeStatus !== 204) return fulfillJson(route, writeStatus, { error: 'stubbed' });

    state.mentors = state.mentors.map((mentor) => (mentor.id === id ? { ...mentor, status: body['status'] as MentorshipProgramMentor['status'] } : mentor));
    return route.fulfill({ status: 204 });
  });
}
