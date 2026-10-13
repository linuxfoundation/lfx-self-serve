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
| 5     | signed-in outsider   | restricted, before                         | `invitation-required`     | the invited-guests copy                         |
| 6     | signed-in organizer  | ended, opened by its composite id          | `tools`                   | recording, AI summary, Who attended, Admin view |
| 7     | anonymous visitor    | ended public meeting with public artifacts | `tools`                   | public recording and summary                    |
| 8     | signed-in viewer     | ended, no artifact access                  | `no-access`               | "details are private", no tools or roster       |
| error | signed-in viewer     | lookup fails (5xx)                         | —                         | alert, Try again, the second-failure copy       |

**Anonymous presets (1, 2, 7) are `fixme` until rollout stage 5.** The V2 gate gives every anonymous
viewer V1 until then (`rollout.md`), and stage 5 is to be validated by these presets. The suite pins
today's behaviour (anonymous viewers get V1) in a test that runs now.

The signed-in presets need the test account (`TEST_USERNAME` / `TEST_PASSWORD`, see
`e2e/helpers/global-setup.ts`); its role on each meeting comes from the stubbed `organizer` /
`invited` flags. E2E is not a CI merge gate today (`quality-check.yml` has the job commented out, H-08).
