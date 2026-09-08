// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateMeetingRegistrantRequest, UpdateMeetingRegistrantRequest } from '@lfx-one/shared/interfaces';

/**
 * Registrant fields the outbound mapper drops whatever their value is.
 *
 * Only `meeting_id` today: the meeting is addressed by the path, so ITX has no field to put it in.
 * A key here can never reach upstream, which is why `MeetingController.hasRegistrantChanges` treats
 * one as no change at all rather than as a change whose value happens to be nullish.
 */
export const UNCONDITIONALLY_DROPPED_REGISTRANT_KEYS = ['meeting_id'] as const satisfies readonly (keyof CreateMeetingRegistrantRequest &
  keyof UpdateMeetingRegistrantRequest)[];

/**
 * Registrant fields the app carries that ITX accepts only under a different name.
 *
 * `MeetingService.toUpstreamRegistrantBody` re-emits these three as `org`, `profile_picture` and
 * `occurrence`, but only when the value is non-nullish — so a nullish one disappears from the
 * outbound body entirely. `MeetingController.hasRegistrantChanges` reads this to decide whether an
 * update actually asks for anything: `{ "org_name": null }` maps to `{}` upstream, so counting it as
 * a change would forward the empty write the guard exists to reject.
 */
export const NULLISH_DROPPED_REGISTRANT_KEYS = ['org_name', 'avatar_url', 'occurrence_id'] as const satisfies readonly (keyof CreateMeetingRegistrantRequest &
  keyof UpdateMeetingRegistrantRequest)[];

/**
 * Every registrant field the app carries but ITX does not accept under that name.
 *
 * `MeetingService.toUpstreamRegistrantBody` deletes all of them from the outbound body. Composed
 * from the two halves above rather than written out again, so the mapper and the
 * `hasRegistrantChanges` guard cannot disagree about which keys exist: adding a key to either half
 * updates the delete loop and the guard in the same edit. Both halves are typed as the
 * *intersection* of the two request interfaces rather than a union — a union only rejects a key once
 * it is gone from both, so renaming it on one of them would still compile while the delete quietly
 * stopped matching.
 */
export const APP_ONLY_REGISTRANT_KEYS = [...UNCONDITIONALLY_DROPPED_REGISTRANT_KEYS, ...NULLISH_DROPPED_REGISTRANT_KEYS] as const;
