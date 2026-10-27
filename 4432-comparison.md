## Reconciling with #4432

#4432 (Manish) states the requirements behind this work, from Angela Brown's decision on the "Event Numbers in LFX" thread. Comparing it against epic #4405 and this PR. Most of it matches; three things differ, one of which was a real gap in my work.

### Already matches

- **Registration goal removed from the event view** — done, on both the Upcoming and Past tabs.
- **Org's own attendee and speaker counts kept, shown post-event** — the attendee column is now the org's own registrant count alone, and the speakers column (accepted / submitted, both org-scoped) was never touched.

### Changed to match (gap in my work)

**"or returned in the API payload"** — I had removed the goal from the template but deliberately left `eventRegistrationsGoal` on the wire, reasoning that one `NULLIF` in a SELECT wasn't worth the churn. That reasoning doesn't survive a requirement about _disclosure_ rather than display. Fixed in `08315fb`: it's gone from the SELECT, the mapper, `OrgEvent`, the warehouse row interface and the e2e stub. An external admin's payload no longer contains the figure.

### Where the premise differs

**"Remove total event attendance"** — there is no total-attendance figure in the Org Lens event view, and there never was. Both tabs render the _same_ field, `EVENT_REGISTRATIONS_GOAL`. So a past event showing `21 / 5,000` was never "21 of the 5,000 who attended" — it was the registration goal, displayed against an event that had already happened.

That matters for two reasons. Removing the goal satisfies both bullets, so there is nothing further to take out. And the reading that prompted the escalation — that external admins were seeing post-event actuals — was understandable but not what the page was doing. If Events specifically wants post-event _actual_ attendance suppressed, that figure would have to be added before it could be removed.

### Confirmations

- **LF-internal views unaffected** — the change is scoped to the Org Lens event service. `project.service.ts` keeps its own `REG_GOAL` for the project surface, untouched. No role gate was needed, so no LF-staff view loses anything.
- **Product/support guidance** — nothing in this repo's docs describes event registration goals or totals as intended for external admins. The only "goal" in the dashboards docs is _sponsorship_ progress on the Foundation Health Metrics page, a different surface. If support content lives outside this repo, that bullet still needs an owner.

### One scope note

This PR also narrows registrant counts to people who registered with a **company email**, tracked under #4408 and epic #4405. That is additional to #4432, not required by it — and it is the larger half of the PR, so it could be split out if landing the goal removal on its own is preferable.

### Related

The data-quality follow-up in #4432 — an attendee who changed employers still appearing under the old org — already has a ticket: #4377, "credit Events and Courses to the employer at the time".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
