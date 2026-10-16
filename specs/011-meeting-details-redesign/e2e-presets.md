# Meeting details V2 — E2E presets

The presets the V2 E2E suite (#3262) and its axe scan (#3260) run on:
`apps/lfx-one/e2e/meeting-details.spec.ts` (content) and `meeting-details-robust.spec.ts` (structure and
axe), with stubs in `e2e/helpers/meeting-details-v2.helper.ts`. They are drawn from the axes in
`state-matrix.md` so that every action-slot family, every viewer role, each time state, anonymous
viewers and the E4 public-artifact path are covered (agreed 2026-10-13, in place of the plan's §6 list,
which is not in this repo).

| #     | Viewer               | Meeting                                    | Action slot (`data-kind`) | Also asserted                                   |
| ----- | -------------------- | ------------------------------------------ | ------------------------- | ----------------------------------------------- |
| 1     | anonymous visitor    | public, before the window                  | `register`                | sign-in prompt                                  |
| 2     | anonymous visitor    | public, live                               | `guest-join`              | guest form                                      |
| 3     | signed-in registrant | before, RSVP tracking on                   | `rsvp`                    | answering confirms it                           |
| 4     | signed-in registrant | live                                       | `join`                    | Join links to the meeting                       |
| 5     | signed-in outsider   | restricted, before, via its invite link    | `invitation-required`     | the invited-guests copy                         |
| 6     | signed-in organizer  | ended, opened by its composite id          | `tools`                   | recording, AI summary, Who attended, Admin view |
| 7     | anonymous visitor    | ended public meeting with public artifacts | `tools`                   | public recording and summary                    |
| 8     | signed-in viewer     | ended, no artifact access                  | `no-access`               | "details are private", no tools or roster       |
| error | signed-in viewer     | lookup fails (5xx)                         | —                         | alert, Try again, the second-failure copy       |

Two more cases cover the requirements the presets alone do not:

- **Reachability (SC-002).** Every illegal row of the matrix (an outsider or visitor on a
  `public-restricted`, `private-open` or `private-restricted` meeting, before or live, with no invite-link
  password) lands on `/meetings/not-found` (robust spec). The stub router enforces the password as the
  BFF does: with `MeetingStubs.password` set, the lookup and the join URL answer 400 unless the
  request carries it in `x-meeting-password`. Preset 5 opens with it, the only way it is reachable.
- **Dialogs.** Preset 6 also opens the transcript and the full AI summary and checks their content
  (content spec).
- **Invitee guest join (SC-003).** An invitee with no session opens the invite link to a restricted
  live meeting, fills the guest form and gets a ready Join link fetched for the typed email (content
  spec).

**Anonymous presets (1, 2, 7) and the anonymous SC-002 and SC-003 cases are `fixme` until rollout stage 5.** The V2 gate gives every anonymous
viewer V1 until then (`rollout.md`), and stage 5 is to be validated by these presets. The suite pins
today's behaviour (anonymous viewers get V1) in a test that runs now.

The signed-in presets need the test account (`TEST_USERNAME` / `TEST_PASSWORD`, see
`e2e/helpers/global-setup.ts`); its role on each meeting comes from the stubbed `organizer` /
`invited` flags. E2E is not a CI merge gate today (`quality-check.yml` has the job commented out, H-08).
