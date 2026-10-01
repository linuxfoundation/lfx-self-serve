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

`noDuplicateProfile` and `complianceAccepted` are validated but have no upstream column. The name and picture go in the optional `lfxProfile`, and the BFF adds the verified primary email (see [LFX profile fields](#lfx-profile-fields)). No phone or slug is sent. The upstream derives the owner from the bearer token and the mentorship user row, and no slug is sent, so this endpoint has no slug to conflict on. The pre-check above is what surfaces "you already registered".

## LFX profile fields

A mentor or mentee profile keeps a copy of the user's LFX profile name, primary email, picture and connected GitHub account's link. Both register forms (mentee here, mentor in [Mentorship Mentor BFF](./mentorship-mentor.md#registration)) send the name and picture, and later LFX profile edits and account connects copy them over again. The email and the GitHub link never come from the browser: the BFF reads them itself.

| Field       | Upstream                          | Source and rule                                                                                                     |
| ----------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `firstName` | `first_name`                      | `lfxProfile`; 1 to `MENTORSHIP_LFX_PROFILE_NAME_MAX` (100) characters (shared `getMentorshipLfxProfileFieldErrors`) |
| `lastName`  | `last_name`                       | `lfxProfile`; 1 to `MENTORSHIP_LFX_PROFILE_NAME_MAX` (100) characters                                               |
| `logoUrl`   | `logo_url`                        | `lfxProfile`; an `https` URL, at most `MENTORSHIP_LFX_PROFILE_LOGO_URL_MAX` (2048)                                  |
| —           | `email`                           | the BFF; see below                                                                                                  |
| —           | `profile_links.githubProfileLink` | the BFF; see below                                                                                                  |

- **The email.** `resolveMentorshipPrimaryEmail` (`helpers/mentorship-lfx-profile.helper.ts`) looks up the caller's verified primary email through `EmailVerificationService.getUserEmails`, keyed by `getEffectiveSub`, and sends it only when it is email-shaped and at most `MENTORSHIP_LFX_PROFILE_EMAIL_MAX` (254). An `email` key in the request body is ignored, so a caller cannot write an address they have not verified. A failed lookup leaves the column as it is rather than failing the save.
- **The GitHub link.** `resolveMentorshipGithubProfileLink` (same helper) reads the caller's identities through `EmailVerificationService.listIdentitiesSafe`, keyed by `getEffectiveSub`, and builds `https://github.com/<login>` from the GitHub identity's login (`profileData.nickname`) only when the login matches `MENTORSHIP_GITHUB_LOGIN_PATTERN`. No GitHub account, a bad login or a failed lookup leaves the stored link as it is. Upstream's `PATCH` replaces `profile_links` whole, so `buildMentorshipUpstreamProfileLinks` lays the link over the row's stored `profile_links`, keeping keys LFX One does not write (`linkedinProfileLink`, `resumeLink`). The mentee and mentor profile edits never send `profile_links`.
- **No LinkedIn link.** A connected LinkedIn account gives the auth service only its email, not a profile URL, so nothing is copied into `linkedinProfileLink`.
- **At registration.** The register page reads `lfxProfileFields` from the `ProfileCardComponent` above the form at submit time, and the shared builder adds `lfxProfile` only when it holds a field. `buildMentorshipLfxProfileFields` trims each value and drops a missing, blank or invalid one, so the request never blanks a column. The card lays any value the edit drawer just saved over the loaded profile, so a save that is still stashed (no profile record yet) is not lost. The server reads the three keys with `readMentorshipLfxProfileFields`, ignores any other key, and rejects a bad value with a `400` keyed `lfxProfile.<field>`. After the `409` pre-check passes, the service resolves the email and the GitHub link and adds them to the `PUT`. Upstream does not validate these columns, so the BFF is the only check.
- **After an Edit LFX Profile save or a Connect.** The card copies the saved name and picture onto the user's mentorship profiles through `PATCH /api/mentorship/me/lfx-profile`, and the BFF adds the primary email and the GitHub link. When the identity-link callback returns with `success=identity_linked`, `ngOnInit` sends an empty body, so the BFF copies the email and the new GitHub link:

```text
ProfileCardComponent.onProfileSaved() / ngOnInit()      only with [syncMentorshipProfiles]="true"; skipped while impersonating
  → lfxProfileFields()                                  card fields with the saved metadata laid over them; {} after a Connect
  → MentorshipService.syncLfxProfileFields()            PATCH /api/mentorship/me/lfx-profile
      → blockDuringImpersonation                        403 IMPERSONATION_READ_ONLY
      → MentorshipController.syncLfxProfile             401 with no signed-in user · 400 per field
      → GET /mentorship/v1/me/profiles                  every page, via listAllMentorshipPages
      → resolveMentorshipPrimaryEmail                   only when there is a mentor or mentee row
      → resolveMentorshipGithubProfileLink              in parallel with the email
      → PATCH /mentorship/v1/me/profiles/by-id/{id}     once per mentor and mentee row; upstream checks the owner
  ← 204                                                 also when the caller has no such row
```

- **Which pages sync.** Every page with the card binds `[syncMentorshipProfiles]="true"`: the mentor and mentee profile, mentee apply, and both register pages. Someone registering in one role may already hold the other role's profile, and the BFF answers `204` without writing when they hold none; the registration itself still sends the fields at submit. While a registration is in flight the card is `inert` with the form, so an Edit LFX Profile save cannot change the name after the request was built.
- **Why by id.** `PATCH …/profiles/{type}` refuses a type that has more than one row, so the BFF patches each row by id, one at a time. Only the keys that have a value are patched; with no field, email or link there is nothing to patch.
- **A failed copy.** A failed row stops the rest. The LFX profile itself did save, so the card logs the error and shows a warn toast (`LFX_PROFILE_CARD_MENTORSHIP_SYNC_FAILED_*`) that asks the user to save again; after a Connect the detail is `LFX_PROFILE_CARD_MENTORSHIP_LINK_SYNC_FAILED_DETAIL`. The request is not tied to the card's lifetime, so a user who saves and then leaves the page still gets the copy, or the toast. Every save sends all the fields, so the next save repairs every row.
- **Primary email changes.** Changing the primary email on the Emails tab does not sync on its own; the next registration or Edit LFX Profile save on a syncing page copies the current primary.
- **Logs.** The controller logs only `synced_count` and `field_count`, and the service `profile_count`, `field_count`, `has_email` and `has_github`; never the values.

## Errors

The frontend maps a failure by status and error code only (`mapMentorshipRegisterFailure` with `MENTORSHIP_MENTEE_REGISTER_FAILURE_OPTIONS`; the mentor form shares it), never by upstream message text.

| Status and code                        | Kind             | UI                                                                   |
| -------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `409` `MENTEE_PROFILE_EXISTS`          | `profile-exists` | Sticky banner with a "Go to my mentee dashboard" button              |
| `409` other                            | `conflict`       | Banner                                                               |
| `403` `IMPERSONATION_READ_ONLY`        | `read-only`      | Sticky banner                                                        |
| `400` with `errors[]` naming form keys | `field-errors`   | Inline error under each named field, plus a warn toast for the first |
| `422`                                  | `ineligible`     | One generic banner (upstream uses 422 for two different causes)      |
| anything else, or a network failure    | `error`          | Generic retry banner                                                 |

A failed save is stored together with the form snapshot as it stands when the failure arrives (the form fields and the profile card are `inert` while the save is in flight, so a user cannot edit them and have the success navigation drop the edit), and the field errors and non-sticky banners are **derived** from that pair: they show only while the form still equals the snapshot. Any real edit dismisses them, while an identical `valueChanges` re-emit (the rich editor emits one when it initialises) does not, which an effect that cleared on every emit would get wrong. The `profile-exists` and `read-only` banners stay until the next submit, because editing the form cannot fix either.

## After a successful save

- With both `programId` and `programTermId` on the URL, the page navigates to `/mentorship/mentee/apply` with those ids and router state `{ menteeProfileCreated: true }`. The apply guard and component read that state once, so the return trip does not depend on the profile check already seeing the new profile.
- Otherwise it navigates to `/mentorship/mentee/overview`.

## Impersonation

The register route and `PATCH /me/lfx-profile` are guarded by `blockDuringImpersonation`. Upstream would otherwise create or replace the **impersonated** user's profile, so the write is refused with `403 IMPERSONATION_READ_ONLY`. The lazy `PUT /mentorship/v1/me` provisioning retry is skipped while impersonating for the same reason. See [Impersonation](./impersonation.md).
