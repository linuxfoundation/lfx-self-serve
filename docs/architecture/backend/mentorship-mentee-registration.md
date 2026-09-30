<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Mentee Registration

The "Become a Mentee" form (`/mentorship/mentee`) saves the mentee's profile through `POST /api/mentorship/mentee/profile` (linuxfoundation/lfx-mentorship#187). The BFF is a thin layer over the mentorship service's `PUT /mentorship/v1/me/profiles/mentee`.

## Flow

```text
MenteeRegisterComponent.onSubmit()
  → getMentorshipMenteeRegisterErrors(form)               client validation (shared)
  → buildMentorshipMenteeRegisterRequest(form)            MentorshipMenteeRegisterRequest
  → MentorshipMenteeService.registerMenteeProfile()       POST /api/mentorship/mentee/profile
      → blockDuringImpersonation                          403 IMPERSONATION_READ_ONLY
      → parseMentorshipMenteeRegisterRequest(body)        types, then the shared wire validator → 400
      → listMenteeProfiles()                              409 MENTEE_PROFILE_EXISTS if one exists
      → PUT /mentorship/v1/me/profiles/mentee             buildMentorshipUpstreamMenteeProfile(request)
  ← 204
```

The wire validator (`getMentorshipMenteeRegisterRequestErrors`) is the single rule set: the form's `getMentorshipMenteeRegisterErrors` delegates to it, so the browser and the server cannot drift.

## Why the BFF checks for an existing profile first

Upstream `PUT …/profiles/mentee` is an **upsert that replaces every column**. A mentee who already has a profile (or who opens the register page from a stale tab) would silently lose the profile they built, including fields this form cannot send. So the BFF lists the caller's mentee profiles first and refuses with a `409` carrying `code: MENTEE_PROFILE_EXISTS` (`ConflictError`). If the pre-check itself fails, the write fails closed rather than risking an overwrite.

The check-then-write pair is not atomic. Two concurrent submits from the same user can still both reach the `PUT`; the register guard and the disabled in-flight Submit button are the practical guards against that.

## What is sent

| Form                                            | Upstream                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `introduction`                                  | `introduction`                                                                      |
| `termsAccepted`                                 | `terms_and_conditions`                                                              |
| `ageEligible`                                   | `age_eligible`                                                                      |
| `workAuthorized`                                | `work_eligible`                                                                     |
| `skillsHave` · `skillsWant` · `additionalNotes` | `skill_set.skills` · `skill_set.improvementSkills` · `skill_set.comments`           |
| `demographics.age` · `gender` · `raceEthnicity` | `demographics.age` · `gender` · `race` (only answers the mentee consented to share) |
| `demographics.income` · `education`             | `socioeconomics.income` · `educationLevel`                                          |

`noDuplicateProfile` and `complianceAccepted` are validated but have no upstream column. Nothing about the user's identity is sent: no name, email, phone, slug or logo. The upstream derives identity from the bearer token and the mentorship user row, and no slug is sent, so this endpoint has no slug to conflict on. The pre-check above is what surfaces "you already registered".

The resume is not sent. Resume upload is coming soon: `ResumeSectionComponent` takes an opt-in `comingSoonSummary` input, and the register page passes one, so choosing a file only shows a coming-soon toast through `MentorshipComingSoonService`. The mentor form keeps the section's original behavior.

## Errors

The frontend maps a failure by status and error code only (`mapMentorshipMenteeRegisterFailure`), never by upstream message text.

| Status and code                        | Kind             | UI                                                                   |
| -------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `409` `MENTEE_PROFILE_EXISTS`          | `profile-exists` | Sticky banner with a "Go to my mentee dashboard" button              |
| `409` other                            | `conflict`       | Banner                                                               |
| `403` `IMPERSONATION_READ_ONLY`        | `read-only`      | Sticky banner                                                        |
| `400` with `errors[]` naming form keys | `field-errors`   | Inline error under each named field, plus a warn toast for the first |
| `422`                                  | `ineligible`     | One generic banner (upstream uses 422 for two different causes)      |
| anything else, or a network failure    | `error`          | Generic retry banner                                                 |

A failed save is stored together with the form snapshot as it stands when the failure arrives (the form stays editable while the save is in flight), and the field errors and non-sticky banners are **derived** from that pair: they show only while the form still equals the snapshot. Any real edit dismisses them, while an identical `valueChanges` re-emit (the rich editor emits one when it initialises) does not, which an effect that cleared on every emit would get wrong. The `profile-exists` and `read-only` banners stay until the next submit, because editing the form cannot fix either.

## After a successful save

- With both `programId` and `programTermId` on the URL, the page navigates to `/mentorship/mentee/apply` with those ids and router state `{ menteeProfileCreated: true }`. The apply guard and component read that state once, so the return trip does not depend on the profile check already seeing the new profile.
- Otherwise it navigates to `/mentorship/mentee/overview`.

## Impersonation

The route is guarded by `blockDuringImpersonation`. Upstream would otherwise create or replace the **impersonated** user's profile, so the write is refused with `403 IMPERSONATION_READ_ONLY`. The lazy `PUT /mentorship/v1/me` provisioning retry is skipped while impersonating for the same reason. See [Impersonation](./impersonation.md).
