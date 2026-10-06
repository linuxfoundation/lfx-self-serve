# Meeting details V2 — rollout and retirement

Plan ID **V2-03** · issue [#2875](https://github.com/linuxfoundation/lfx-self-serve/issues/2875) ·
epic [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765) · Meetings v2 epic
[#1451](https://github.com/linuxfoundation/lfx-self-serve/issues/1451)

How V2 of the meeting details page gets from code to every viewer, who decides each step, what has
to be true before the next one, and how V1 and the flag gate are removed at the end.

There are two separate controls, and they do different jobs:

- **The branch controls whether the code is in production at all.** Nothing in this epic reaches
  `main` until the whole project is built.
- **The flag controls who sees V2 once the code is in production.** It is UI-only and gates no
  endpoint (R02).

## Fixed rules

- **The code default never changes.** `MEETING_V2_ENABLED_FLAG` defaults to `false` in code and stays
  `false`. LaunchDarkly targeting is the only switch (R04). Flipping the code default would ship V2
  to everyone at once, with no way back short of a deploy.
- **Fail closed.** A flag provider that is not ready, slow or erroring before its first value renders
  V1 (R03). After that, a provider error keeps the last delivered value rather than tearing down an
  open page.
- **Anonymous visitors get V1** until stage 5 below. Stage 5 is the deliberate, code-owner-reviewed
  end of R05; `spec.md` R05 and FR-001 are scoped to the stages before it.
- **Rollback is a targeting change, not a deploy**, for signed-in viewers. Removing a viewer from
  targeting puts them back on V1 as soon as the change reaches their browser: the gate is reactive,
  so an open V2 page is replaced by V1 in place, and anything unsaved on it (a half-filled form, an
  open dialog) is lost. Announce a rollback to testers when you can. Stages 2 to 4 rely on this.
  Stage 5 is the exception: anonymous visitors move by a code change, so their rollback is a revert.
- **Dev and prod targeting are configured identically**, so what testers see in dev is what they get
  in prod.
- The flag is shared with the meeting composer (epic #1451). Changing targeting moves **both**
  surfaces for the targeted viewer. If the two ever need different audiences, that is the moment to
  split the flag (an open question in the implementation plan, not one of the D-1 to D-4 decisions in
  `state-matrix.md`); until then they move together.

## No server-side flag decision (#2920)

SSR never evaluates `MEETING_V2_ENABLED_FLAG`. The server has no flag source, so it renders V1 for
every signed-in viewer, and the gate swaps in V2 after hydration for a targeted one. Giving SSR the
decision ([#2920](https://github.com/linuxfoundation/lfx-self-serve/issues/2920): a LaunchDarkly
server SDK in the BFF, or a BFF-stamped cookie) was considered and **declined on 2026-10-06**:

- V2 ships as one release (#3249), and its only use for a server-side decision would be a gradual
  percentage ramp. Signed-in viewers instead move from named tester lists to everyone in one step
  (stage 4).
- A server-side evaluation path for user context is a security change that has to ship on its own
  (R06), for a page whose V1 is deleted shortly after.

What that accepts:

- **The swap reaches every signed-in viewer during stages 4 to 6**: their first paint is V1, then V2
  replaces it once the lazy chunk arrives. It ends at stage 7, when the gate is removed and V2 is
  the route's own component, rendered on the server.
- **No ramp.** A V2 bug that the tester stages miss reaches every signed-in viewer at once, until
  targeting is rolled back. Stages 2 and 3 carry that weight, so do not shorten them.
- Anonymous visitors need no flag at all, so stage 5 renders V2 for them on the server too, with no
  swap.

Revisit this only if a gradual ramp becomes a requirement; #2920's scope still describes the work.

## Stages

Each stage names who decides and what must be true to move on. Do not skip a stage; a stage may be
repeated with a wider audience.

| #   | Stage                                  | Who sees V2                                                               | Decides                                                       | Exit criteria (all must hold)                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | **Build** on `feat/meeting-details-v2` | nobody in production; developers locally                                  | project owner                                                 | Every planned Phase 1 and Phase 2 PR merged into the integration branch. CI green on the release PR #3249. E5-04 E2E suite green and binding. Code-owner sign-off on the protected `AGENTS.md` line from #2911.                                                                                                                                                                                                                      |
| 1   | **Release**: merge #3249 into `main`   | nobody: targeting is empty, V2 is dark                                    | project owner + code owners (`@linuxfoundation/lfx-platform`) | Production deploy healthy. With the flag off, V1 renders exactly as before (the V1 layout-parity check from #2910, repeated against the deployed build). No new errors in Datadog RUM for `/meetings/:id`.                                                                                                                                                                                                                           |
| 2   | **Internal testers**                   | a named list: the team building it                                        | project owner                                                 | One full week with no open P1/P2 bug against V2. Every legal signed-in state in `state-matrix.md` exercised by a tester at least once (visitor rows wait for stage 5). Error rate and join success on `/meetings/:id` for testers no worse than V1's for the same week.                                                                                                                                                              |
| 3   | **Extended testers**                   | a named list across personas: maintainers, EDs, board members, organizers | project owner, with product                                   | Two weeks with no P1/P2. Feedback from each persona reviewed and triaged. Organizer flows checked: RSVP aggregate, occurrence edit and cancel, materials manage.                                                                                                                                                                                                                                                                     |
| 4   | **All signed-in users**                | every authenticated viewer, in one targeting step                         | project owner                                                 | No percentage ramp: see § No server-side flag decision. Every signed-in viewer now gets the post-hydration swap, which is accepted. Two weeks with no P1/P2 and no rollback. Error rate, join-URL success rate and RSVP submission rate within normal variance of V1's baseline; no rise in meeting-related support tickets.                                                                                                         |
| 5   | **Anonymous visitors**                 | logged-out visitors on public meetings                                    | project owner + code owners                                   | A **code change**, not targeting: the gate hard-codes anonymous viewers to V1 today, and this PR sends every anonymous visitor to V2 instead. They need no flag read, so the server renders V2 for them directly, with no swap and no new identifier sent to LaunchDarkly. Validated by the anonymous E2E presets (visitor rows of `state-matrix.md`) and an SSR parity check. Ships in its own PR. Rollback is a revert of that PR. |
| 6   | **Soak at 100%**                       | everyone                                                                  | project owner                                                 | The agreed soak period (suggested: two release cycles) at 100% of signed-in and anonymous traffic with no rollback. Then V1 retirement starts.                                                                                                                                                                                                                                                                                       |
| 7   | **Retire V1**                          | everyone, with no V1 to fall back to                                      | project owner + code owners                                   | Done by [#3266](https://github.com/linuxfoundation/lfx-self-serve/issues/3266), the named V1-deletion checklist. Its preconditions are stages 0–6 above and `v2-scaffold.md` § Definition of done.                                                                                                                                                                                                                                   |

### What we measure

While both cohorts exist, the comparison is V2 viewers against V1 viewers over the same window, so
seasonal traffic does not read as a regression. Once a cohort is gone (stage 4 has no signed-in V1
viewers; stage 6 has no V1 viewers at all), the baseline is V1's figures from the two weeks before
that step, recorded when the step is taken, plus the V2 figures from the step before it. A
regression against either baseline holds the stage.

- **Errors**: Datadog RUM errors and failed requests on `/meetings/:id`.
- **Joins**: rate of successful `POST /public/api/meetings/:id/join-url`, including the
  `NOT_REGISTERED_FOR_MEETING` rate on restricted meetings, which D-1 changes for anonymous
  invitees.
- **RSVP**: RSVP submissions per registrant view, on meetings with RSVP tracking on.
- **Registration**: self-registrations per outsider view on public, unrestricted meetings.
- **Performance**: LCP for `/meetings/:id`. V2 is a lazy chunk swapped in after hydration, so the
  first paint for signed-in viewers is the one to watch until stage 7 removes the gate.
- **Support**: meeting-related tickets that mention the details page.

## Rolling back

| Situation                                       | Action                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A V2 bug for signed-in viewers, stages 2 to 6   | Remove the affected audience from targeting. Fix in a normal PR to `main`: V2 is still behind targeting, so the fix reaches only targeted viewers.                                                                                              |
| A V2 bug for anonymous visitors, stages 5 and 6 | Revert the stage 5 PR in a normal PR to `main`, which sends anonymous visitors back to V1; then fix forward.                                                                                                                                    |
| A V1 regression after stage 1                   | See below.                                                                                                                                                                                                                                      |
| Flag provider outage                            | Before the first flag value: nothing to do, the gate fails closed to V1. After it: viewers keep the last value they had (V2 stays V2), so an outage cannot be used as a rollback; remove the audience from targeting once the provider is back. |
| A problem after stage 7 (V1 is deleted)         | No flag fallback exists any more. Fix forward, which is why stage 6's soak comes first.                                                                                                                                                         |

### A V1 regression after the release

The release does change what V1 viewers run, even with targeting empty:

- `/meetings/:id` routes to the gate, which renders V1 (V2-01).
- V1's files moved to `meeting-join-v1/`, byte-identical (V2-02).
- Every BFF change in the epic (E3-03, E4-02, E4-04 and any other) is live for V1 too, because no
  endpoint is flag-gated (R02).

So the first response is a targeted revert of the offending change, in a normal PR to `main`. If the
gate itself is at fault, point the route back at V1 directly. Reverting #3249's whole merge is the
last resort, and only clean before any follow-up PR has landed on `main` on top of it; after that it
conflicts, takes the follow-ups with it, and pulls V2 from every tester.

## Retiring the flag

Stage 7 removes **this page's** read of `MEETING_V2_ENABLED_FLAG` and the gate component. It does not
delete the flag: the meeting composer and other meetings v2 surfaces read it too. The flag itself is
deleted from code and from LaunchDarkly only when the last surface that reads it has retired its V1.
