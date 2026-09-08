// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateMeetingRegistrantRequest, UpdateMeetingRegistrantRequest } from '@lfx-one/shared/interfaces';

/**
 * Registrant fields the app carries but ITX does not accept under that name.
 *
 * `MeetingService.toUpstreamRegistrantBody` deletes all four from the outbound body: `meeting_id`
 * because the meeting is addressed by the path, and the other three because they are re-emitted
 * under ITX's spelling (`org`, `profile_picture`, `occurrence`).
 *
 * Typed as the *intersection* of the two request interfaces rather than a union: a union only
 * rejects a key once it is gone from both, so renaming it on one of them would still compile while
 * the delete quietly stopped matching. All four exist on both, so this fails the build on either
 * rename.
 */
export const APP_ONLY_REGISTRANT_KEYS = [
  'meeting_id',
  'org_name',
  'avatar_url',
  'occurrence_id',
] as const satisfies readonly (keyof CreateMeetingRegistrantRequest & keyof UpdateMeetingRegistrantRequest)[];

/**
 * The subset of {@link APP_ONLY_REGISTRANT_KEYS} that is re-emitted under ITX's spelling, and so
 * disappears from the outbound body entirely when the value is nullish.
 *
 * `MeetingController.hasRegistrantChanges` reads this to decide whether an update actually asks for
 * anything: `{ "org_name": null }` maps to `{}` upstream, so counting it as a change would forward
 * the empty write the guard exists to reject. Both sites read the same list so they cannot drift.
 */
export const NULLISH_DROPPED_REGISTRANT_KEYS = [
  'org_name',
  'avatar_url',
  'occurrence_id',
] as const satisfies readonly (keyof CreateMeetingRegistrantRequest & keyof UpdateMeetingRegistrantRequest)[];
