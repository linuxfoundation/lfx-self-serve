<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Company Lens all employee view: personal data review register

Internal engineering note for epic #5845, story #5861. Not Help Center copy. User-facing text says "company", never "organization" (epic #5060); identifiers keep the `org` names.

The rule of the view: an employee sees counts, charts and company-level totals. The only personal data allowed is data from a **public code contribution**, the kind anyone can find on GitHub or LFX Insights without logging in. This register lists every place a name, email or other person-level value could reach an employee-view user, per page and per endpoint, with a verdict and a status. It is checked by a unit test (see [How the register is enforced](#how-the-register-is-enforced)).

It describes the view **with the page pull requests (#5869 to #5880) applied** on top of the access gate (#5863). Nothing here is verified against a running service; every row comes from reading the code of those branches. The register is machine-readable in `packages/shared/src/constants/org-lens-employee-view-register.constants.ts`; this document and that file are kept in step.

## How to read it

| Column      | Meaning                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed?    | `Yes, public code contribution`: may show a value. `No, count only`: must never leave the API as a value. `Not personal` and `Own data` are listed for completeness.  |
| Enforcement | What does the work: `blocked-403`, `refused-by-default` (analytics gate), `stripped`, `anonymised`, `not-queried`, `not-in-field-list`, `by-construction`, or `none`. |
| Status      | `enforced`; `gap` (a value can reach the user today); `decision` (enforced, but the product owner has a call to make); `unverified` (not provable from code alone).   |

## Findings

### Gaps: a name, email or free text can reach an employee today

1. ~~Projects workspace names~~ **Fixed.** `GET /lens/workspaces` now returns neutral `Workspace N` names for user-created workspaces in the employee view; ids, slugs and counts are unchanged.
2. ~~Crowdfunding initiative name, description and website~~ **Fixed.** The shared strip scrubs embedded emails and personal URLs from every string, covering these fields.
3. ~~Embedded emails in free text~~ **Fixed.** `stripPersonalFields` replaces an address inside a string, not only a value that is wholly an email.
4. ~~Overview analytics routes answer 403~~ **Fixed.** The four involvement routes (`org-involvement-*-monthly`, `org-foundation-coverage`) now sit behind `requireOrgAnalyticsAccessAllowingEmployeeView` (`allowEmployeeView: true`). They return aggregate counts, monthly series and foundation names only, and their handlers still redact, so the Overview charts load for an employee. Every other analytics route still refuses the employee view.

### Allowed names, and why they are a decision

Project detail's five Technical Influence panels (maintainers, contributors, commits, pull requests, average merge time) show person name, avatar, initials and, for contributors, the GitHub username. Commit authors, pull request authors and the GitHub handle are public. The **display name and avatar** come from the CDP identity and the project people table, not from the public GitHub profile, and the maintainer name comes from the CDP maintainer roles table. These fields are not in the shared personal-field list, so they pass without an `ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS` entry (an entry would have no effect on a key that is never stripped). The register is the record of the allowance. The Projects "Our Contributors" count links straight into the contributors panel, so one click from a count reaches named people.

### Decisions for the product owner

Resolved by the product owner:

- **Crowdfunding initiative, transaction and announcement routes** (`/api/crowdfunding/initiatives/:slug...`): a simple client block is accepted; the data is not sensitive.
- **The all-company roll-up** (and per-family roll-ups) is not available to employee-view users; admins and staff only.

Still open:

- **Small counts: decided.** Small counts are allowed with **no minimum floor**; a count does not reveal a name. No suppression helper is planned.
- **Crowdfunding donation rows** (initiative, date, amount) are per-person records without a name when the donor is an individual matched to the company.
- **Commits feed on Code Contributions** is removed entirely. That is stricter than the epic allows (public committer names and handles could show); job title and person key never could.

### Unverified

- The rollout flag `LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED` must stay off until the whole stack has merged.
- No screenshots are included: producing them needs the real services.

### Checked and fine

ROI routes are LF-staff only. EasyCLA is refused by the CLA read gate. Every non-GET under `/lens` is refused in the employee view. The Projects CSV export writes counts only. Error and empty-state messages are fixed strings. Leaderboards name other companies, which is company-level data.

## Register

### Overview

| Id                                       | Where shown                                                                                | Endpoint                                                                 | Field                                                       | Example                   | Source    | Allowed?                     | Enforcement        | Status   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------- | --------- | ---------------------------- | ------------------ | -------- |
| `overview.foundations.board-seat-counts` | Foundations and Projects stat strip                                                        | `GET /api/orgs/:orgUid/lens/foundations-and-projects`                    | `statStrip.governanceRoles.boardMembers / committeeMembers` | `boardMembers: 1`         | snowflake | No, count only               | by-construction    | enforced |
| `overview.foundations.role-badges`       | Foundations and Projects rows                                                              | `GET /api/orgs/:orgUid/lens/foundations-and-projects`                    | `rows[].badges / membershipTierDisplayName`                 | `orgRole: 'Director'`     | snowflake | Not personal (company level) | by-construction    | enforced |
| `overview.analytics.involvement-charts`  | Involvement section (contributors, maintainers, event attendance, foundation coverage)     | `GET /api/analytics/org-involvement-*-monthly, /org-foundation-coverage` | `monthlyData / monthlyLabels / totals`                      | `monthlyData: [4, 6, 5]`  | snowflake | No, count only               | by-construction    | enforced |
| `overview.analytics.key-members`         | Maintainers drawer key members list                                                        | `GET /api/analytics/org-maintainers-key-members`                         | `members[].fullName / title / photoUrl / userId`            | `fullName: 'Ada Example'` | snowflake | No, count only               | refused-by-default | enforced |
| `overview.analytics.other-routes`        | Other /api/analytics org routes (certified employees, training enrollments, distributions) | `GET /api/analytics/org-* and /organization-*`                           | `monthly series and distributions`                          | `monthlyData: [2, 3]`     | snowflake | No, count only               | refused-by-default | enforced |

### Projects

| Id                             | Where shown                                                            | Endpoint                                                      | Field                                                              | Example                              | Source         | Allowed?       | Enforcement     | Status   |
| ------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ | -------------- | -------------- | --------------- | -------- |
| `projects.table.person-name`   | Projects table avatar stacks (maintainers, contributors, participants) | `GET /api/orgs/:orgUid/lens/projects`                         | `projects[].maintainers / contributors / participants[].name`      | `name: ''`                           | cdp            | No, count only | anonymised      | enforced |
| `projects.table.person-id`     | payload only                                                           | `GET /api/orgs/:orgUid/lens/projects`                         | `projects[].maintainers / contributors / participants[].id`        | `id: 'example-project:maintainer:0'` | cdp            | No, count only | anonymised      | enforced |
| `projects.table.person-avatar` | Projects table avatar stacks                                           | `GET /api/orgs/:orgUid/lens/projects`                         | `projects[].maintainers / contributors / participants[].avatarUrl` | `avatarUrl: ''`                      | cdp            | No, count only | anonymised      | enforced |
| `projects.table.person-counts` | Our Contributors / Our Participants columns                            | `GET /api/orgs/:orgUid/lens/projects`                         | `projects[].contributors.length / participants.length`             | `contributors: 1`                    | cdp            | No, count only | by-construction | enforced |
| `projects.workspaces.name`     | Workspace selector                                                     | `GET /api/orgs/:orgUid/lens/workspaces`                       | `workspaces[].name`                                                | `name: 'Platform team'`              | member-service | No, count only | anonymised      | enforced |
| `projects.csv.counts`          | Export to CSV                                                          | `client only, built from GET /api/orgs/:orgUid/lens/projects` | `Our Contributors / Our Participants columns`                      | `contributors: 3`                    | cdp            | No, count only | anonymised      | enforced |

### Project detail

| Id                                               | Where shown                                                | Endpoint                                                                                          | Field                                                                                                 | Example                      | Source    | Allowed?                      | Enforcement       | Status   |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------- | --------- | ----------------------------- | ----------------- | -------- |
| `project-detail.technical.maintainers`           | Maintainers panel                                          | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/maintainers[/roster]`                            | `rows[].cells[].person.name / avatarUrl / initials, role start and end dates`                         | `name: 'Ada Example'`        | insights  | Yes, public code contribution | not-in-field-list | decision |
| `project-detail.technical.contributors`          | Contributors panel (reached from the Projects table count) | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/contributors[/roster]`                           | `rows[].cells[].person.name / avatarUrl / initials, username, first and last activity, contributions` | `username: 'example-handle'` | insights  | Yes, public code contribution | not-in-field-list | decision |
| `project-detail.technical.commits`               | Commits panel                                              | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/commits[/roster]`                                | `rows[].cells[].person.name / avatarUrl / initials, commit date`                                      | `name: 'Ada Example'`        | insights  | Yes, public code contribution | not-in-field-list | decision |
| `project-detail.technical.pull-requests`         | Pull Requests panel                                        | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/pull-requests[/roster]`                          | `rows[].cells[].person.name / avatarUrl / initials, opened date`                                      | `name: 'Ada Example'`        | insights  | Yes, public code contribution | not-in-field-list | decision |
| `project-detail.technical.avg-merge-time`        | Average Merge Time panel                                   | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/avg-merge-time[/roster]`                         | `rows[].cells[].person.name / avatarUrl / initials, merge time`                                       | `name: 'Ada Example'`        | insights  | Yes, public code contribution | not-in-field-list | decision |
| `project-detail.technical.free-text`             | Commits and Pull Requests panels                           | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/{commits,pull-requests,avg-merge-time}`          | `rows[].cells[].text (commit message, PR title)`                                                      | `text: 'Fix cache eviction'` | github    | Yes, public code contribution | stripped          | enforced |
| `project-detail.ecosystem.board-members`         | Ecosystem Influence card: board-members                    | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/board-members[/roster]`                          | `rows[].cells[].person.name / avatarUrl / initials, location, event or meeting names`                 | `name: 'Ada Example'`        | snowflake | No, count only                | blocked-403       | enforced |
| `project-detail.ecosystem.committee-members`     | Ecosystem Influence card: committee-members                | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/committee-members[/roster]`                      | `rows[].cells[].person.name / avatarUrl / initials, location, event or meeting names`                 | `name: 'Ada Example'`        | snowflake | No, count only                | blocked-403       | enforced |
| `project-detail.ecosystem.certified-individuals` | Ecosystem Influence card: certified-individuals            | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/certified-individuals[/roster]`                  | `rows[].cells[].person.name / avatarUrl / initials, location, event or meeting names`                 | `name: 'Ada Example'`        | snowflake | No, count only                | blocked-403       | enforced |
| `project-detail.ecosystem.event-attendance`      | Ecosystem Influence card: event-attendance                 | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/event-attendance[/roster]`                       | `rows[].cells[].person.name / avatarUrl / initials, location, event or meeting names`                 | `name: 'Ada Example'`        | snowflake | No, count only                | blocked-403       | enforced |
| `project-detail.ecosystem.event-speakers`        | Ecosystem Influence card: event-speakers                   | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/event-speakers[/roster]`                         | `rows[].cells[].person.name / avatarUrl / initials, location, event or meeting names`                 | `name: 'Ada Example'`        | snowflake | No, count only                | blocked-403       | enforced |
| `project-detail.ecosystem.meeting-attendance`    | Ecosystem Influence card: meeting-attendance               | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/meeting-attendance[/roster]`                     | `rows[].cells[].person.name / avatarUrl / initials, location, event or meeting names`                 | `name: 'Ada Example'`        | snowflake | No, count only                | blocked-403       | enforced |
| `project-detail.ecosystem.event-sponsorships`    | Ecosystem Influence card: event-sponsorships               | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/event-sponsorships[/roster]`                     | `rows[].cells[].person.name / avatarUrl / initials, location, event or meeting names`                 | `name: 'Ada Example'`        | snowflake | No, count only                | blocked-403       | enforced |
| `project-detail.ecosystem.collaboration`         | Ecosystem Influence card: collaboration                    | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/collaboration[/roster]`                          | `rows[].cells[].person.name / avatarUrl / initials, location, event or meeting names`                 | `name: 'Ada Example'`        | snowflake | No, count only                | blocked-403       | enforced |
| `project-detail.ecosystem.meetup-attendance`     | Ecosystem Influence card: meetup-attendance                | `GET /api/orgs/:orgUid/lens/projects/:slug/cards/meetup-attendance[/roster]`                      | `rows[].cells[].person.name / avatarUrl / initials, location, event or meeting names`                 | `name: 'Ada Example'`        | snowflake | No, count only                | blocked-403       | enforced |
| `project-detail.ecosystem.leaderboard-breakdown` | Ecosystem leaderboard row panel                            | `GET /api/orgs/:orgUid/lens/projects/:slug/leaderboard/ecosystem/organizations/:id`               | `categories[] points and counts`                                                                      | `points: 12`                 | snowflake | No, count only                | blocked-403       | enforced |
| `project-detail.leaderboards.company-names`      | Technical and ecosystem leaderboards                       | `GET /api/orgs/:orgUid/lens/projects/:slug/leaderboard/{technical,ecosystem}[/organizations/:id]` | `rows[].orgName`                                                                                      | `orgName: 'Example Corp'`    | insights  | Not personal (company level)  | by-construction   | enforced |

### Code Contributions

| Id                                   | Where shown        | Endpoint                                                                      | Field                                                                                  | Example                        | Source    | Allowed?       | Enforcement     | Status   |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ | --------- | -------------- | --------------- | -------- |
| `code-contributions.commits-feed`    | Commits tab        | `GET /api/orgs/:orgUid/lens/contributions?view=commits`                       | `commits[].committerName / committerAvatarUrl / committerTitle / username / personKey` | `committerName: 'Ada Example'` | snowflake | No, count only | not-queried     | enforced |
| `code-contributions.employee-filter` | Employees filter   | `GET /api/orgs/:orgUid/lens/contributions (employeeOptions, employees query)` | `employeeOptions[].displayName / id`                                                   | `displayName: 'Ada Example'`   | snowflake | No, count only | not-queried     | enforced |
| `code-contributions.repo-rows`       | Repositories table | `GET /api/orgs/:orgUid/lens/contributions`                                    | `repositories[].commits / firstCommitTs / lastCommitTs`                                | `commits: 1`                   | insights  | No, count only | by-construction | enforced |

### Events

| Id                       | Where shown                                          | Endpoint                                               | Field                                                                   | Example               | Source | Allowed?       | Enforcement     | Status   |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------- | ------ | -------------- | --------------- | -------- |
| `events.attendees-panel` | Registered / attended side panel (past and upcoming) | `GET /api/orgs/:orgUid/lens/events/:eventId/attendees` | `data[].name / title / avatar`                                          | `name: 'Ada Example'` | lfx    | No, count only | blocked-403     | enforced |
| `events.speakers-panel`  | Speakers side panel                                  | `GET /api/orgs/:orgUid/lens/events/:eventId/speakers`  | `data[].name / title / avatar`                                          | `name: 'Ada Example'` | lfx    | No, count only | blocked-403     | enforced |
| `events.counts`          | Events table                                         | `GET /api/orgs/:orgUid/lens/events`                    | `orgAttendeeCount / orgSpeakerAcceptedCount / orgSpeakerSubmittedCount` | `orgAttendeeCount: 1` | lfx    | No, count only | by-construction | enforced |

### Training

| Id                             | Where shown                              | Endpoint                                                      | Field                                                                | Example                           | Source    | Allowed?       | Enforcement     | Status   |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------- | --------- | -------------- | --------------- | -------- |
| `training.learners-drilldown`  | Certified / In progress count drill-down | `GET /api/orgs/:orgUid/lens/training/groups/employees`        | `data[] (learner name, enrollment)`                                  | `name: 'Ada Example'`             | snowflake | No, count only | blocked-403     | enforced |
| `training.outside-people-list` | Learners not on the people list tile     | `GET /api/orgs/:orgUid/lens/training/stats`                   | `learnersOutsidePeopleList`                                          | `learnersOutsidePeopleList: null` | snowflake | No, count only | stripped        | enforced |
| `training.group-counts`        | Group-by table and filter dropdowns      | `GET /api/orgs/:orgUid/lens/training/{groups,filter-options}` | `data[].people / completed / inProgress; course and project options` | `people: 1`                       | snowflake | No, count only | by-construction | enforced |

### Meetings

| Id                    | Where shown                                                       | Endpoint                                                    | Field                                             | Example               | Source    | Allowed?       | Enforcement | Status   |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- | --------------------- | --------- | -------------- | ----------- | -------- |
| `meetings.aggregates` | KPI strip, Where your people spend time, ecosystem influence rows | `GET /api/orgs/:orgUid/lens/meetings/{kpi,spend,influence}` | `employeesActive, spend segments, influence rows` | `employeesActive: 12` | snowflake | No, count only | stripped    | enforced |

### Crowdfunding

| Id                                              | Where shown                                     | Endpoint                                                                 | Field                                                                              | Example                                   | Source       | Allowed?       | Enforcement | Status   |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------- | ------------ | -------------- | ----------- | -------- |
| `crowdfunding.donations.donor-name`             | Donations table, Donor column                   | `GET /api/crowdfunding/org-donations`                                    | `data[].donorName`                                                                 | `donorName: 'Ada Example'`                | crowdfunding | No, count only | stripped    | enforced |
| `crowdfunding.donations.donor-email`            | Donations table, Email column                   | `GET /api/crowdfunding/org-donations`                                    | `data[].donorEmail`                                                                | `donorEmail: user@example.com`            | crowdfunding | No, count only | stripped    | enforced |
| `crowdfunding.donations.anonymous-flag`         | payload only                                    | `GET /api/crowdfunding/org-donations`                                    | `data[].anonymous`                                                                 | `anonymous: true`                         | crowdfunding | No, count only | stripped    | enforced |
| `crowdfunding.donations.row-records`            | Donations table                                 | `GET /api/crowdfunding/org-donations`                                    | `data[] initiative, date, amountCents`                                             | `amountCents: 5000`                       | crowdfunding | No, count only | none        | decision |
| `crowdfunding.initiatives.creator`              | Initiative cards                                | `GET /api/crowdfunding/initiatives?scope=organizations`                  | `data[].creator`                                                                   | `creator: 'Ada Example'`                  | crowdfunding | No, count only | stripped    | enforced |
| `crowdfunding.initiatives.personal-attribution` | Initiative cards                                | `GET /api/crowdfunding/initiatives?scope=organizations`                  | `data[].attribution.name`                                                          | `attribution: { type: 'personal' }`       | crowdfunding | No, count only | stripped    | enforced |
| `crowdfunding.initiatives.free-text`            | Initiative cards                                | `GET /api/crowdfunding/initiatives?scope=organizations`                  | `data[].name / description / websiteUrl`                                           | `name: 'Community lab'`                   | crowdfunding | No, count only | stripped    | enforced |
| `crowdfunding.initiatives.detail-routes`        | Initiative detail (the client route is blocked) | `GET /api/crowdfunding/initiatives/:slug[/transactions\|/announcements]` | `sponsors[].name / avatarUrl, beneficiaries[].name / email, donorName, donorEmail` | `beneficiaries[].email: user@example.com` | crowdfunding | No, count only | none        | enforced |

### Navigation

| Id                         | Where shown                             | Endpoint                                                   | Field                                            | Example                    | Source         | Allowed?                     | Enforcement     | Status   |
| -------------------------- | --------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ | -------------------------- | -------------- | ---------------------------- | --------------- | -------- |
| `navigation.own-identity`  | Header, user menu, role-grants response | `GET /api/orgs/me/role-grants`                             | `username / name / avatar of the signed-in user` | `username: 'example-user'` | lfx            | Own data                     | by-construction | enforced |
| `navigation.company-names` | Company selector, empty state           | `GET /api/orgs/me/role-grants, /api/orgs/resolve/:segment` | `employeeView.orgName, selector rows`            | `orgName: 'Example Corp'`  | member-service | Not personal (company level) | by-construction | enforced |

### Hidden pages

| Id                   | Where shown                                                                                                                    | Endpoint                                                                        | Field                                                               | Example                        | Source         | Allowed?       | Enforcement | Status   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------ | -------------- | -------------- | ----------- | -------- |
| `hidden.memberships` | Memberships (list, detail, board and committee seats, key contacts, documents, voting history)                                 | `/api/orgs/:orgUid/lens/memberships/**, /lens/employees, /lens/key-contacts/**` | `seat holders, key contacts, employee picker (name, email, title)`  | `name: 'Ada Example'`          | member-service | No, count only | blocked-403 | enforced |
| `hidden.people`      | People (all, former, key contacts, committee, board, trainees, event attendees, contributors, drawers) and Company Lens Access | `/api/orgs/:orgUid/lens/people/**, /lens/access/**`                             | `name, email, title, role, enrollment, registration, grant holders` | `email: user@example.com`      | cdp            | No, count only | blocked-403 | enforced |
| `hidden.easycla`     | Easy CLA (groups, managers, approval lists, activity, signing)                                                                 | `/api/orgs/:orgUid/lens/cla-groups/**`                                          | `CLA managers, approved contributors, signatory (name, email)`      | `email: user@example.com`      | lfx            | No, count only | blocked-403 | enforced |
| `hidden.profile`     | Company profile (record, addresses, logo)                                                                                      | `/api/orgs/uid/:uid, /api/orgs/uid/:uid/addresses, /api/orgs/:id`               | `company record, contact addresses, domains`                        | `primaryDomain: 'example.com'` | member-service | No, count only | blocked-403 | enforced |
| `hidden.groups`      | Groups and committee seat holders                                                                                              | `/api/orgs/:orgUid/lens/groups, /lens/people/committee-members`                 | `seat holders (name, email), committee seat counts`                 | `name: 'Ada Example'`          | member-service | No, count only | blocked-403 | enforced |

### Cross-cutting

| Id                    | Where shown                                   | Endpoint              | Field                                  | Example                            | Source    | Allowed?                     | Enforcement     | Status     |
| --------------------- | --------------------------------------------- | --------------------- | -------------------------------------- | ---------------------------------- | --------- | ---------------------------- | --------------- | ---------- |
| `all.small-counts`    | Every count on every shown page               | `all shown routes`    | `any count of 1 or 2`                  | `count: 1`                         | snowflake | No, count only               | none            | enforced   |
| `all.embedded-email`  | Free-text fields on every shown page          | `all shown routes`    | `any string field`                     | `text: 'Contact user@example.com'` | lfx       | No, count only               | stripped        | enforced   |
| `all.exports`         | Exports, downloads and tooltips               | `client only`         | `Projects CSV; avatar and aria labels` | `header: Our Contributors`         | lfx       | No, count only               | anonymised      | enforced   |
| `all.errors-and-logs` | Error responses, empty states and server logs | `all routes`          | `error message and code`               | `code: 'EMPLOYEE_VIEW_FORBIDDEN'`  | lfx       | Not personal (company level) | by-construction | enforced   |
| `all.rollout-flag`    | LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED            | `server feature flag` | `flag state`                           | `false`                            | lfx       | No, count only               | none            | unverified |

## Endpoints

Every route under `/api/orgs/:orgUid/lens` in `orgs.route.ts`, path parameter names written as `:p`. Treatments: `counts` (aggregates), `redacted` (strip or anonymise), `public-code-only`, `blocked` (403), `other-gate` (LF staff only), `read-only-refused`, `free-text` (a gap, see the register). Routes outside the lens prefix (`/api/analytics/*`, `/api/crowdfunding/*`, `/api/orgs/uid/:uid`) are in the register above.

| Method | Path                                                          | Page               | Treatment         |
| ------ | ------------------------------------------------------------- | ------------------ | ----------------- |
| GET    | `/:p/lens/access/users`                                       | hidden             | blocked           |
| POST   | `/:p/lens/access/users`                                       | hidden             | read-only-refused |
| DELETE | `/:p/lens/access/users/:p`                                    | hidden             | read-only-refused |
| PUT    | `/:p/lens/access/users/:p`                                    | hidden             | read-only-refused |
| GET    | `/:p/lens/contributions`                                      | code-contributions | counts            |
| GET    | `/:p/lens/edit-check`                                         | navigation         | counts            |
| GET    | `/:p/lens/employees`                                          | hidden             | blocked           |
| GET    | `/:p/lens/events`                                             | events             | counts            |
| GET    | `/:p/lens/events/:p/attendees`                                | events             | blocked           |
| GET    | `/:p/lens/events/:p/speakers`                                 | events             | blocked           |
| GET    | `/:p/lens/events/foundations`                                 | events             | counts            |
| GET    | `/:p/lens/events/summary`                                     | events             | counts            |
| GET    | `/:p/lens/foundations-and-projects`                           | overview           | redacted          |
| GET    | `/:p/lens/groups`                                             | hidden             | blocked           |
| GET    | `/:p/lens/key-contacts/employees`                             | hidden             | blocked           |
| GET    | `/:p/lens/key-contacts/membership/:p`                         | hidden             | blocked           |
| POST   | `/:p/lens/key-contacts/membership/:p`                         | hidden             | read-only-refused |
| DELETE | `/:p/lens/key-contacts/membership/:p/:p`                      | hidden             | read-only-refused |
| PUT    | `/:p/lens/key-contacts/membership/:p/:p`                      | hidden             | read-only-refused |
| GET    | `/:p/lens/meetings/influence`                                 | meetings           | redacted          |
| GET    | `/:p/lens/meetings/kpi`                                       | meetings           | redacted          |
| GET    | `/:p/lens/meetings/spend`                                     | meetings           | redacted          |
| GET    | `/:p/lens/memberships/:p`                                     | hidden             | blocked           |
| PATCH  | `/:p/lens/memberships/:p/committee-seats/:p/reassign`         | hidden             | read-only-refused |
| GET    | `/:p/lens/memberships/:p/documents`                           | hidden             | blocked           |
| POST   | `/:p/lens/memberships/:p/key-contacts`                        | hidden             | read-only-refused |
| DELETE | `/:p/lens/memberships/:p/key-contacts/:p`                     | hidden             | read-only-refused |
| PUT    | `/:p/lens/memberships/:p/key-contacts/:p`                     | hidden             | read-only-refused |
| GET    | `/:p/lens/memberships/:p/projects`                            | hidden             | blocked           |
| GET    | `/:p/lens/memberships/:p/seats`                               | hidden             | blocked           |
| GET    | `/:p/lens/memberships/:p/voting-history`                      | hidden             | blocked           |
| GET    | `/:p/lens/memberships/active`                                 | hidden             | blocked           |
| GET    | `/:p/lens/memberships/discover`                               | hidden             | blocked           |
| GET    | `/:p/lens/memberships/expired`                                | hidden             | blocked           |
| GET    | `/:p/lens/org-scope`                                          | code-contributions | counts            |
| GET    | `/:p/lens/people/:p/company-emails`                           | hidden             | blocked           |
| GET    | `/:p/lens/people/:p/detail`                                   | hidden             | blocked           |
| GET    | `/:p/lens/people/:p/key-contacts`                             | hidden             | blocked           |
| GET    | `/:p/lens/people/all`                                         | hidden             | blocked           |
| GET    | `/:p/lens/people/board-members`                               | hidden             | blocked           |
| PATCH  | `/:p/lens/people/board-members/:p/reassign`                   | hidden             | read-only-refused |
| GET    | `/:p/lens/people/by-key-contact/company-emails`               | hidden             | blocked           |
| GET    | `/:p/lens/people/by-username/:p/company-emails`               | hidden             | blocked           |
| GET    | `/:p/lens/people/by-username/:p/detail`                       | hidden             | blocked           |
| GET    | `/:p/lens/people/by-username/:p/key-contacts`                 | hidden             | blocked           |
| GET    | `/:p/lens/people/committee-members`                           | hidden             | blocked           |
| PATCH  | `/:p/lens/people/committee-members/:p/reassign`               | hidden             | read-only-refused |
| GET    | `/:p/lens/people/contributors`                                | hidden             | blocked           |
| GET    | `/:p/lens/people/event-attendees`                             | hidden             | blocked           |
| GET    | `/:p/lens/people/former`                                      | hidden             | blocked           |
| GET    | `/:p/lens/people/key-contacts`                                | hidden             | blocked           |
| GET    | `/:p/lens/people/trainees`                                    | hidden             | blocked           |
| GET    | `/:p/lens/projects`                                           | projects           | redacted          |
| GET    | `/:p/lens/projects/:p/cards/:p`                               | project-detail     | public-code-only  |
| GET    | `/:p/lens/projects/:p/cards/:p/roster`                        | project-detail     | public-code-only  |
| GET    | `/:p/lens/projects/:p/hero`                                   | project-detail     | counts            |
| GET    | `/:p/lens/projects/:p/influence`                              | project-detail     | counts            |
| GET    | `/:p/lens/projects/:p/leaderboard/ecosystem`                  | project-detail     | counts            |
| GET    | `/:p/lens/projects/:p/leaderboard/ecosystem/organizations/:p` | project-detail     | blocked           |
| GET    | `/:p/lens/projects/:p/leaderboard/technical`                  | project-detail     | counts            |
| GET    | `/:p/lens/projects/:p/leaderboard/technical/organizations/:p` | project-detail     | counts            |
| GET    | `/:p/lens/projects/:p/trend`                                  | project-detail     | counts            |
| GET    | `/:p/lens/projects/search`                                    | projects           | counts            |
| GET    | `/:p/lens/read-check`                                         | navigation         | counts            |
| GET    | `/:p/lens/roi/annual`                                         | all                | other-gate        |
| GET    | `/:p/lens/roi/coverage`                                       | all                | other-gate        |
| GET    | `/:p/lens/roi/investment-breakdown`                           | all                | other-gate        |
| GET    | `/:p/lens/roi/projects`                                       | all                | other-gate        |
| GET    | `/:p/lens/roi/projects/:p`                                    | all                | other-gate        |
| GET    | `/:p/lens/roi/projects/:p/annual`                             | all                | other-gate        |
| GET    | `/:p/lens/roi/summary`                                        | all                | other-gate        |
| GET    | `/:p/lens/roi/value-drivers`                                  | all                | other-gate        |
| GET    | `/:p/lens/training/filter-options`                            | training           | counts            |
| GET    | `/:p/lens/training/groups`                                    | training           | counts            |
| GET    | `/:p/lens/training/groups/employees`                          | training           | blocked           |
| GET    | `/:p/lens/training/stats`                                     | training           | counts            |
| GET    | `/:p/lens/workspaces`                                         | projects           | redacted          |
| POST   | `/:p/lens/workspaces`                                         | projects           | read-only-refused |
| DELETE | `/:p/lens/workspaces/:p`                                      | projects           | read-only-refused |
| PUT    | `/:p/lens/workspaces/:p`                                      | projects           | read-only-refused |
| POST   | `/:p/lens/workspaces/:p/projects`                             | projects           | read-only-refused |
| DELETE | `/:p/lens/workspaces/:p/projects/:p`                          | projects           | read-only-refused |

## How the register is enforced

`apps/lfx-one/src/server/helpers/org-lens-employee-view-personal-data.spec.ts` runs with the server specs and fails when the code and the register drift:

- A personal field is allowed without a register row: an `ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS` entry with no matching `exceptions-allow-list` row (and the reverse), an `allowed` row outside Project detail's technical panels, or one without a `publicBasis`.
- `ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS` changes: removing a key (which would let that field through) or adding one needs the reviewed snapshot updated.
- A route is added under `/lens` without a treatment, a project detail roster card key without a technical or ecosystem classification, or an `allowEmployeeView: true` analytics opt-in without a registered reason.
- A new `org-*.interface.ts` file is not classified, or a payload interface gains a person-bearing property or type (email, name, avatar, committer, donor, speaker, attendee, learner and similar) that no register row covers.
- A `gap`, `decision` or `unverified` row has no follow-up.

The spec checks that the register matches the code, not that each page PR enforces its row; the page PRs carry their own tests for that. Re-run the sweep on every release of the view: re-read the page PRs, update the rows, and keep this document and the constants file together.

## Related

- [Company Lens all employee view](./company-lens-employee-view.md): the access gate and the redaction tools.
