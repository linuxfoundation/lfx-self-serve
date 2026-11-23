// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Stubs for answering a mentor invitation (linuxfoundation/lfx-mentorship#378): the email link's page,
 * `/mentorship/mentor/invites?token=` (POST `/api/mentorship/mentor/invites/{accept|decline}` with the token), and the
 * invitation rows in the mentor profile drawer (#346), which answer by membership id. Data is synthetic, and the stubs
 * record what the page sent.
 */

import { MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE } from '@lfx-one/shared/constants';
import { Page, Route } from '@playwright/test';

/** Shaped like upstream's signed token (`payload.signature`), so the page sends it. */
export const INVITE_TOKEN = 'e2e-invite-payload.e2e-invite-signature';
export const INVITE_PAGE_URL = `/mentorship/mentor/invites?token=${INVITE_TOKEN}`;
export const MENTOR_PROFILE_URL = '/mentorship/mentor/profile';

export const INVITATION_ID = 'c0e2e378-0000-4000-8000-000000000001';
export const INVITATION_PROGRAM = { id: 'c0e2e378-0000-4000-8000-000000000002', name: 'Test Program Invited' };

/** How a stub answers a write: a status, and for a 403 whether it is the impersonation read-only refusal. */
export interface InviteAnswer {
  status: number;
  readOnly?: boolean;
}

/** Every write the page sent, as `METHOD /path` and its JSON body. */
export type InviteWrites = { method: string; path: string; body: unknown }[];

const fulfill = (route: Route, answer: InviteAnswer) => {
  if (answer.status === 204) return route.fulfill({ status: 204 });
  const body = answer.readOnly ? { error: 'Read-only while impersonating', code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE } : { error: 'stubbed' };
  return route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(body) });
};

const record = (writes: InviteWrites, route: Route) => {
  const request = route.request();
  writes.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() });
};

/** Answers the email link's Accept and Decline with each answer in turn, the last one again once they run out. */
export async function stubInviteResponse(page: Page, answers: InviteAnswer[] = [{ status: 204 }]): Promise<InviteWrites> {
  const writes: InviteWrites = [];
  await page.route('**/api/mentorship/mentor/invites/*', (route) => {
    record(writes, route);
    return fulfill(route, answers[Math.min(writes.length, answers.length) - 1]);
  });
  return writes;
}

export interface DrawerInviteState {
  writes: InviteWrites;
  /** How many times the drawer read the requests and invitations. */
  reads: number;
}

/**
 * Stubs the mentor profile and the drawer's reads, with one invitation pending, and answers its Accept and Decline with
 * `answer`. A write that succeeds takes the invitation off the list, as upstream does, so the drawer's next read drops it.
 */
export async function stubDrawerInvitation(page: Page, answer: InviteAnswer = { status: 204 }): Promise<DrawerInviteState> {
  const state: DrawerInviteState = { writes: [], reads: 0 };
  let invited = true;

  await page.route('**/api/mentorship/mentor/profile', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: { aboutMe: '', skills: [] }, history: [] }) })
      : route.fallback()
  );
  await page.route('**/api/mentorship/mentor/open-programs**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) })
  );
  await page.route('**/api/mentorship/mentor/requests', (route) => {
    state.reads++;
    const invitations = invited ? [{ id: INVITATION_ID, programId: INVITATION_PROGRAM.id, programName: INVITATION_PROGRAM.name }] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], invitations }) });
  });
  await page.route(`**/api/mentorship/mentor/invitations/${INVITATION_ID}/*`, (route) => {
    record(state.writes, route);
    if (answer.status === 204) invited = false;
    return fulfill(route, answer);
  });

  return state;
}
