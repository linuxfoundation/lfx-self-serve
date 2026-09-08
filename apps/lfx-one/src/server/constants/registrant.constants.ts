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
 * Registrant fields the app carries that ITX accepts only under a different name, mapped to it.
 *
 * The app's read model comes from the v1 query-service index, not from ITX, and spells these three
 * `org_name`, `avatar_url` and `occurrence_id`; `CreateItxRegistrantRequestBody` declares them `org`,
 * `profile_picture` and `occurrence`. Goa silently ignores body keys it doesn't declare, so an
 * unrenamed key is dropped upstream behind a 201.
 *
 * A map rather than a list of names because `MeetingService.toUpstreamRegistrantBody` has to do two
 * things with each of these — delete the app-side key and re-emit the value under the upstream one —
 * and those were previously written out in two places. A fourth key added to a bare list would have
 * been deleted from the outbound body and then never re-emitted: silent data loss, no type error.
 * Here one entry drives both halves.
 *
 * `MeetingController.hasRegistrantChanges` reads the key side to decide whether an update actually
 * asks for anything: a nullish value on one of these is omitted rather than renamed, so
 * `{ "org_name": null }` maps to `{}` upstream and counting it as a change would forward the empty
 * write the guard exists to reject.
 */
export const RENAMED_REGISTRANT_KEYS = {
  org_name: 'org',
  avatar_url: 'profile_picture',
  occurrence_id: 'occurrence',
} as const satisfies Partial<Record<keyof CreateMeetingRegistrantRequest & keyof UpdateMeetingRegistrantRequest, string>>;

/**
 * The app-side names of {@link RENAMED_REGISTRANT_KEYS} — the keys dropped when, and only when, the
 * value is nullish.
 */
export const NULLISH_DROPPED_REGISTRANT_KEYS = Object.keys(RENAMED_REGISTRANT_KEYS) as (keyof typeof RENAMED_REGISTRANT_KEYS)[];

/**
 * Every registrant field the app carries but ITX does not accept under that name.
 *
 * `MeetingService.toUpstreamRegistrantBody` deletes all of them from the outbound body. Composed
 * from the two halves above rather than written out again, so the mapper and the
 * `hasRegistrantChanges` guard cannot disagree about which keys exist: adding a key to either half
 * updates the delete loop, the upstream re-emit, and the guard in the same edit. Both halves are
 * keyed on the *intersection* of the two request interfaces rather than a union — a union only rejects a key once
 * it is gone from both, so renaming it on one of them would still compile while the delete quietly
 * stopped matching.
 */
export const APP_ONLY_REGISTRANT_KEYS = [...UNCONDITIONALLY_DROPPED_REGISTRANT_KEYS, ...NULLISH_DROPPED_REGISTRANT_KEYS] as const;
