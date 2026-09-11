// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MeetingRegistrant } from '../interfaces/meeting.interface';

/**
 * The only registrant fields a public self-registration response carries back to the caller.
 * @description An allowlist, so a column added to the upstream registrant row later has to be named here before
 * a self-registrant can see it. The route sits under `/public/api`, but the handler behind it requires a
 * session of its own, so the reader is an authenticated self-registrant rather than an anonymous caller — the
 * narrowing is about what a person may learn from registering themselves, not about who reached the endpoint.
 * Shared rather than local to the controller because the client types the same response off it — a server-side
 * narrowing the client still typed as a full `MeetingRegistrant` is how a caller ends up reading a field the
 * wire never carried. The derived response type is `PublicMeetingRegistrationResponse`
 * (`meeting.interface.ts`).
 *
 * Its own file rather than `meeting.constants.ts` so it stays a runtime leaf — the only import here
 * is type-only, which lets a spec that mocks the constants barrel pull the real list in by relative
 * path instead of hand-copying it.
 */
export const PUBLIC_SELF_REGISTRATION_RESPONSE_KEYS = [
  'uid',
  'meeting_id',
  'email',
  'first_name',
  'last_name',
  'host',
  'job_title',
  'org_name',
  'occurrence_id',
  'avatar_url',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof MeetingRegistrant)[];
