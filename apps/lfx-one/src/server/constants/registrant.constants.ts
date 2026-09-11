// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateMeetingRegistrantRequest, UpdateMeetingRegistrantRequest } from '@lfx-one/shared/interfaces';

/**
 * Registrant fields the outbound mapper never forwards, whatever their value is.
 *
 * Only `meeting_id` today: the meeting is addressed by the path, so ITX has no field to put it in.
 * A key here can never reach upstream — it is absent from
 * {@link UPSTREAM_PASSTHROUGH_REGISTRANT_KEYS} and has no rename to carry it — which is why
 * `MeetingController.hasRegistrantChanges` treats one as no change at all rather than as a change
 * whose value happens to be nullish.
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
 * things with each of these — keep the app-side key out of the outbound body and re-emit the value
 * under the upstream one — and those were previously written out in two places. A fourth key added
 * to a bare list would have been withheld from the outbound body and then never re-emitted: silent
 * data loss, no type error. Here one entry drives both halves, and the same entry is what excludes
 * the app-side name from {@link UPSTREAM_PASSTHROUGH_REGISTRANT_KEYS}.
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
 * The app-side names of {@link RENAMED_REGISTRANT_KEYS}.
 *
 * "Nullish-dropped" is about what reaches upstream, not about the outbound body: the app-side key
 * never appears in it either way. What the value decides is whether it is re-emitted under the
 * upstream name — a nullish one is not, so the pair leaves nothing behind, and that is the case
 * `MeetingController.hasRegistrantChanges` has to treat as no change at all.
 */
export const NULLISH_DROPPED_REGISTRANT_KEYS = Object.keys(RENAMED_REGISTRANT_KEYS) as (keyof typeof RENAMED_REGISTRANT_KEYS)[];

/**
 * Registrant fields ITX declares under the app's own name, as a non-nullable `type: string`.
 *
 * `getChangedFields` sends `null` to mean "the organizer cleared this", and for these two it used to
 * send it straight through: a declared field given an off-contract value, on an ordinary registrant
 * edit. `job_title` has a form control, so an organizer emptying it hits this every time; `username`
 * has none, so it is nulled on every edit that changes anything at all.
 *
 * Omitted rather than renamed-away, because there is nowhere to rename them to — the name is
 * already right, only the `null` is wrong. The cost is the same one the renamed three carry:
 * clearing a job title on an edit leaves the stored value in place. That is what happens today
 * anyway — at best upstream ignores the key, at worst it rejects the write — so nothing
 * regresses, and it stays that way until upstream states how a declared string is erased. Don't
 * guess between `null` and `''`; a wrong guess writes a real value where the organizer asked for
 * none.
 *
 * `linkedin_profile` is deliberately absent: it isn't declared upstream under any name, so Goa
 * discards the whole key and its `null` never reaches a field. Nor does any other value it could
 * carry, which is why it is listed unconditionally in {@link UNDECLARED_UPSTREAM_REGISTRANT_KEYS}
 * instead of here.
 */
export const NON_NULLABLE_UPSTREAM_REGISTRANT_KEYS = ['job_title', 'username'] as const satisfies readonly (keyof CreateMeetingRegistrantRequest &
  keyof UpdateMeetingRegistrantRequest)[];

/**
 * Registrant fields the mapper forwards under their own name that ITX declares nowhere.
 *
 * Update-only, so keyed on {@link UpdateMeetingRegistrantRequest} alone rather than on the intersection
 * the deletion lists use — `linkedin_profile` does not exist on the create shape, and an intersection
 * would silently accept nothing.
 *
 * These are still forwarded: see {@link UPSTREAM_PASSTHROUGH_REGISTRANT_KEYS} for why the outbound
 * body states the app's intent even where Goa drops it. What this list changes is the *counting*.
 * A key here reaches upstream and lands on no field whatever its value, so an update carrying only
 * one of them asks upstream for nothing — exactly the empty `PUT` that
 * `MeetingController.hasRegistrantChanges` exists to reject, and one it used to wave through
 * because the key was on the passthrough allowlist. Unconditional, unlike
 * {@link NULLISH_OMITTED_REGISTRANT_KEYS}: there is no value that makes an undeclared field land.
 *
 * The day upstream declares one of these, deleting it here is the whole change — the forwarding is
 * already in place.
 */
export const UNDECLARED_UPSTREAM_REGISTRANT_KEYS = ['linkedin_profile'] as const satisfies readonly (keyof UpdateMeetingRegistrantRequest)[];

/**
 * Every registrant key whose nullish value reaches upstream as nothing at all.
 *
 * The two halves get there differently — {@link NULLISH_DROPPED_REGISTRANT_KEYS} are dropped because the rename
 * that would carry them upstream is skipped, {@link NON_NULLABLE_UPSTREAM_REGISTRANT_KEYS} are allowed through
 * by name but skipped on `null` — but the consequence is identical, and it is the consequence
 * `MeetingController.hasRegistrantChanges` has to count: a `null` on any of these makes the outbound body no
 * larger, so counting it as a change forwards the empty `PUT` that guard exists to reject.
 */
export const NULLISH_OMITTED_REGISTRANT_KEYS = [...NULLISH_DROPPED_REGISTRANT_KEYS, ...NON_NULLABLE_UPSTREAM_REGISTRANT_KEYS] as const;

/**
 * Every registrant field the app carries but ITX does not accept under that name.
 *
 * `MeetingService.toUpstreamRegistrantBody` forwards none of them under that name: this list is what {@link
 * UPSTREAM_PASSTHROUGH_REGISTRANT_KEY_MAP} excludes from the allowlist, so a key here is one the mapper is
 * required *not* to declare. Composed from the two halves above rather than written out again, so the mapper
 * and the `hasRegistrantChanges` guard cannot disagree about which keys exist: adding a key to either half
 * updates the allowlist's exclusion, the upstream re-emit, and the guard in the same edit. Both halves are
 * keyed on the *intersection* of the two request interfaces rather than a union — a union only rejects a key
 * once it is gone from both, so renaming it on one of them would still compile while the delete quietly stopped
 * matching.
 */
export const APP_ONLY_REGISTRANT_KEYS = [...UNCONDITIONALLY_DROPPED_REGISTRANT_KEYS, ...NULLISH_DROPPED_REGISTRANT_KEYS] as const;

/**
 * Every registrant key the outbound mapper forwards upstream under its own name.
 *
 * `MeetingService.toUpstreamRegistrantBody` picks these out of the submitted body rather than
 * copying the body wholesale and deleting what it recognises. The two shapes look equivalent for a
 * body that matches its declared type, and are not for one that doesn't: the registrant routes carry
 * no express-validator, `req.body` is untyped JSON, and both batch controllers spread it, so a client
 * can name any key it likes. Under a denylist an unlisted key — `uid` being the one that matters —
 * reached upstream unexamined; under this allowlist it is simply absent from the outbound body.
 *
 * Written as the keys of a `satisfies Record<—, true>` so the check runs in both directions: a
 * misspelt or removed field is rejected, *and* a field added to either request interface fails to
 * compile until it is listed here. That second half is the point — an allowlist's failure mode is
 * silent omission, and the deletion lists above already showed what an unenforced list costs.
 *
 * Keyed on the *union* of the two request interfaces, unlike {@link APP_ONLY_REGISTRANT_KEYS} and
 * the lists it is built from. Those describe keys that must vanish, so they take the intersection —
 * a union would let a rename on one interface silently stop matching. This one describes keys that
 * must survive, and a key that exists on only one of the two shapes still has to be accounted for,
 * so the union is the exhaustive set. `committee_uid` is create-only and `linkedin_profile`
 * update-only; both are listed for that reason.
 *
 * `linkedin_profile` is forwarded even though Goa discards it — it isn't declared upstream under
 * any name. Listing it keeps the outbound body byte-identical to what the denylist produced and
 * states the app's intent, so the day upstream declares the field it starts working without a
 * second edit. See {@link UpdateMeetingRegistrantRequest} for the tracking note. Being forwarded is
 * not the same as doing something, though, so it is also named in
 * {@link UNDECLARED_UPSTREAM_REGISTRANT_KEYS} and does not count as a change on its own.
 */
const UPSTREAM_PASSTHROUGH_REGISTRANT_KEY_MAP = {
  email: true,
  first_name: true,
  last_name: true,
  host: true,
  job_title: true,
  username: true,
  committee_uid: true,
  linkedin_profile: true,
} as const satisfies Record<
  Exclude<keyof CreateMeetingRegistrantRequest | keyof UpdateMeetingRegistrantRequest, (typeof APP_ONLY_REGISTRANT_KEYS)[number]>,
  true
>;

/**
 * The key list of {@link UPSTREAM_PASSTHROUGH_REGISTRANT_KEY_MAP}, in declaration order.
 *
 * Same shape as {@link NULLISH_DROPPED_REGISTRANT_KEYS}: the map carries the exhaustiveness check,
 * this is what the mapper iterates.
 */
export const UPSTREAM_PASSTHROUGH_REGISTRANT_KEYS = Object.keys(
  UPSTREAM_PASSTHROUGH_REGISTRANT_KEY_MAP
) as (keyof typeof UPSTREAM_PASSTHROUGH_REGISTRANT_KEY_MAP)[];
