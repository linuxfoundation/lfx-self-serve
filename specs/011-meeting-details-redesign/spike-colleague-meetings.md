# S-01 — Colleague meetings: feasibility and privacy review

**Issue**: [#3610](https://github.com/linuxfoundation/lfx-self-serve/issues/3610) ·
**Epic**: [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765) · **Phase**: 3 ·
**Status**: decision proposed, privacy review **requested, not signed off**

## Decision

**Defer.** Don't build "N colleagues attending" in meeting details V2, and file no implementation
issues for it. Remove the section from the prototype so the design stops promising it. The V2 page
already renders nothing for it (see [V2 page today](#v2-page-today)), and it must stay that way
until this spike is reopened.

Reasoning:

1. **Three independent upstream gaps, plus an unowned consent store.** Each needs a contract change
   in a service this repo doesn't own, and the feature needs all of them. That is roughly L + M + M,
   plus M for consent, of upstream work for one sidebar line.
2. **The privacy question is the larger cost.** Today a viewer sees a meeting's guests only when
   the organizer shares the guest list. This feature would answer a different question, "who from
   your employer is attending X", and would answer it for people outside the meeting's audience.
   No consent model covers that.
3. **Low value against V2's scope.** Every Phase 1 and Phase 2 item serves the meeting itself; this
   serves social proof. The organizer-shared guest list in the people section already covers the
   legitimate case.

Reopen when **both** of these hold: upstream has an authorization-grade user → organization binding,
and privacy has signed off on a consent model. Reopening it means a new spike, not this doc's
estimates.

## What the feature needs

To show "3 colleagues attending" to viewer V on meeting M, the page needs:

| #   | Piece                                                                           | Owner                                                                                                   |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| D1  | A stable org identifier on each registrant and participant (not free text)      | `lfx-v2-meeting-service` (v1/ITX record, indexer contract)                                              |
| D2  | An authorization-grade binding from V to one or more organizations              | Unowned today. Candidates: CDP (work experiences), `lfx-v2-auth-service` (verified emails), member data |
| D3  | A query: M's registrants whose org id ∈ V's orgs, gated by a rule that admits V | `lfx-v2-meeting-service` (index tags + FGA relation), `lfx-v2-query-service` (unchanged if tagged)      |
| D4  | A consent / opt-out signal per attendee, honoured by D3                         | `lfx-v2-meeting-service` or a profile-level preference (no owner today)                                 |
| D5  | The BFF endpoint and V2 UI                                                      | `lfx-self-serve`                                                                                        |

## Blockers, verified

Verified on 2026-10-20 against this branch and the upstream default branches. The issue's three
blockers hold; two of them needed their wording corrected.

### 1. No org identity on attendees — confirmed

- **Upstream:** `lfx-v2-meeting-service` `pkg/models/itx/meeting_registrants.go` carries `Org` as a
  free-text string. The past-participant model (`pkg/models/itx/past_meeting_participants.go`) also
  has `Org` free text, plus `OrgIsMember` and `OrgIsProjectMember`. The `v1_meeting_registrant`
  indexer contract (`docs/indexer-contract.md`) indexes `org_name`, `org_is_member` and
  `org_is_project_member`. Its tags are `registrant_uid`, `committee_uid`, `username`, `email` and
  `host`, with no org tag and no org id.
- **Where `org_name` comes from:** the v1/ITX registrant `org`, either typed at registration or
  entered by an organizer. When it is blank, the registrant event handler copies it from the
  self-edited v1 user profile. Neither source is verified.
- **Partial exception:** committee members carry a structured `organization.id`
  (`lfx-v2-committee-service`), so a committee registrant could be joined to an org id through its
  `committee_uid`. That attributes a seat; it doesn't verify identity, and it covers only committee
  registrants.
- **Here:** `MeetingRegistrant` and the participant types in
  `packages/shared/src/interfaces/meeting.interface.ts` mirror this (`org_name: string | null`).
- **`org_is_member`** means "the attendee's employer is an LF member". It says nothing about being
  in the same organization as the viewer. It is used as an LF-member tally
  (`meeting-registrants-manager.component.ts`, `memberCount`).

### 2. No trustworthy viewer → org binding — confirmed, wording corrected

- `PersonaDetectionService.extractOrganizations`
  (`apps/lfx-one/src/server/services/persona-detection.service.ts`) only collects an org from
  `board_member` detections. Most viewers get none.
- **Correction:** the issue cites `WorkExperience.organizationId` with a
  `Verified | Unverified | Suggested` status. That type exists (`profile.interface.ts`), but the BFF's
  actual CDP mapping (`cdp.service.ts`, `getWorkExperiencesForUser`) returns `WorkExperienceEntry`.
  It carries `organizationId`, a `source` (`manual` or `cdp-enriched`) and
  `needsReview = !(verified && verifiedBy === sub)`. Either way the org is self-asserted, or comes
  from enrichment the user confirmed. The conclusion stands: it isn't authorization-grade.
- The `b2b_org` FGA object (`lfx-v2-member-service` `docs/fga-contract.md`) has writer and auditor
  grants and an LF-staff auditor team. It has no employee relation. The
  `organization` field in `lfx-v2-auth-service` user metadata is self-edited.
- **Partial precedent:** the newsletter coworker invite (#3483,
  `newsletter-invite.service.ts`) matches the caller's **verified emails**
  (`resolveVerifiedUserEmails`) by domain against a foundation's member roster, rejecting personal
  domains. That is the closest thing to an employer binding in the repo. It covers only LF-member
  orgs with a known domain, and it misses people who use a personal or alternate address. It shows
  that domain matching is workable for an invite, which the recipient confirms. It isn't strong
  enough to disclose other people's attendance.

### 3. No cross-meeting attendee query — confirmed, wording corrected

- **Correction:** `GET /meetings/:uid/registrants` isn't strictly organizer-gated.
  - Its complete-roster path needs the organizer relation.
  - Its tolerant listing is gated by `MeetingService.canViewMeetingRoster`: an organizer, or a
    registrant of a meeting whose guest list is shared.
  - "Shared" is `isMeetingAttendeeListShared`: `show_meeting_attendees` on, not a Board meeting,
    not restricted.
- `GET /meetings/:uid/my-meeting-registrants` applies the same rule. A non-organizer registrant gets
  `[]` unless the list is shared.
- Both endpoints are scoped to one meeting, so neither can find colleagues across meetings.
- The org-lens people endpoints sit behind `requireOrgLensAccess` (`routes/orgs.route.ts`). It calls
  `assertOrgLensRead`, which needs an org roster grant or `b2b_org#auditor`. A rank-and-file
  viewer doesn't pass it.
- **Upstream:** query-service can filter on data fields (`filters_all=org_name:…`). But
  `v1_meeting_registrant` access checks `viewer` on the parent `v1_meeting`, which is wider than the
  BFF's roster gate. A colleague query can't rely on it; it would need the dedicated relation
  below. The filter is also an exact
  match on free text, so "Acme" and "Acme Inc." don't match each other.

## Estimated upstream work

Sizes are S (days), M (a sprint), L (more than a sprint, or cross-team). Where a contract couldn't be
confirmed, the assumption is stated.

| Service                                        | Size | Work                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lfx-v2-meeting-service`                       | M    | Resolve and store an org id (SFID or `b2b_org` uid) on registrants and participants. Add it to the indexer contract as data and an `org_uid:` tag. Backfill existing records. Assumes the v1/ITX source can supply the id. If ITX only has free text, add an ITX change (L).                        |
| `lfx-v2-meeting-service` + `lfx-v2-helm` (FGA) | M    | A relation for "may see same-org attendees of this meeting" that respects `restricted`, Board and private meetings and the attendee's opt-out. It must not reuse `viewer`. Model change in the platform `model.yaml`, tuples written by the meeting service.                                        |
| User → org binding (owner to be decided)       | L    | An authorization-grade employer binding, for example verified email domain → `b2b_org`, or CDP affiliations promoted to verified, exposed as a contract the BFF can trust. No service owns this today, so it needs an owner decision first. Unconfirmed: whether CDP verification is strong enough. |
| Consent / opt-out (owner to be decided)        | M    | A per-user or per-registration "hide me from colleague views" preference, applied upstream in the query, not in the BFF. Default (opt-in or opt-out) is the privacy review's call.                                                                                                                  |
| `lfx-v2-query-service`                         | S    | No change expected if D1 adds an `org_uid` tag and D3's relation is the access check. Unconfirmed: count/aggregate semantics under per-object access filtering.                                                                                                                                     |
| `lfx-self-serve`                               | S    | BFF endpoint returning a count (and names only if privacy allows), V2 people-section row, tests.                                                                                                                                                                                                    |

## Privacy review

**Requested, not given.** Before any build decision, privacy and legal need to answer:

- **Who sees whom.** "Colleagues attending X" tells every employee of an organization which
  co-workers attend which meetings. The organizer agreed to share the guest list with the meeting's
  invitees. Neither the organizer nor the attendees agreed to share it with their employer.
- **Consent and opt-out.** Attendees registered under today's terms. A new disclosure needs either
  opt-in consent or a clear opt-out, honoured upstream, plus notice in the registration flow.
  No per-attendee consent or hide field exists in the meeting-service design, its index contracts or
  the auth-service user metadata. The only switch is the organizer's meeting-level
  `show_meeting_attendees`.
- **Restricted, Board and private meetings.** These must never contribute. Today's
  `isMeetingAttendeeListShared` is the floor, not the ceiling: a shared guest list still hasn't
  consented to colleague discovery.
- **GDPR-style concerns.** Attendance at, for example, a security working group, a union-adjacent
  one or a competitor's can reveal affiliations or job-search activity. Purpose limitation, data
  minimisation (a count instead of names) and the employer as a recipient all need a ruling.
- **Inference risk.** Even a bare count leaks. In a small organization, or a meeting with one
  attendee from the org, "1 colleague attending" names the person. Repeated queries across meetings
  rebuild an employee's calendar. Any build needs a minimum-count threshold and an aggregate-only
  answer at least.
- **Wrong org binding.** A self-asserted or stale employer turns this into a disclosure to the
  wrong company. That is why D2 has to be authorization-grade.

## V2 page today

Checked `apps/lfx-one/src/app/modules/meetings/meeting-details-page/` on this branch:

- **No colleagues placeholder, copy or test id.** A search for colleague, employer, coworker and
  same-org wording finds nothing.
- **`components/people`** renders the organizer-shared roster under V1's gate (organizer, or a
  registrant when the guest list is shared).
- **`components/past-people`** shows each row's free-text `org_name`.

No code change is needed. The V2 page must not add a colleagues section while this is deferred.

## Follow-ups

- Design: remove the "N colleagues attending" section from the prototype.
- [#3610](https://github.com/linuxfoundation/lfx-self-serve/issues/3610) closes once the privacy
  review has ruled. If it rejects the deferral, a new spike replaces this one.
