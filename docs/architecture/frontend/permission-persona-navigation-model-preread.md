# Permission, Persona, and Navigation Model

Working spec for aligning how the LFX Self Serve experience in this repo decides where users can go, what they see, and what they can do.

## TL;DR

Separate the product model into four decisions:

- **Where can I go?** Outside of Me, `auditor` access (explicit or inherited) is what's needed to browse into a Foundation/Project/Organization context. It's the only relation that matters for context entry: any higher relation (writer, owner) includes `auditor` by inheritance.
- **What is my persona there?** Persona shapes presentation — navigation, dashboards, sections, and metrics — never access.
- **What can I do there?** Each action checks the specific relation its API call requires against the target object. That's often `writer`, but not always — for example, meeting organizer, or the author-only edit rule on poll responses.
- **What can I discover?** Discovery surfaces let users find events, meetups, packages, projects, foundations, groups, and subscription surfaces outside their current contexts.

The key rule:

```text
Context access is not action authority.
Every gate is an evaluated FGA relation check.
Persona shapes presentation only.
Code branches on evaluated relation checks, never on role or persona labels.
```

## Core Principle

Personas (Board Member, Contributor, Maintainer, and the presentation use of
ED) are detected signals for shaping the experience — they are not modeled
in OpenFGA, except that ED also happens to correspond to a real relation
(see Persona pairs and Terminology below).

OpenFGA relations exist as a model (graph) describing how relationships
evaluate transitively across the objects we define — for example, writers
of a project include the writers of that project's parent; writers of a
committee include the writers of the committee's project. A tuple is a
concrete edge in that graph for real data (project A is a parent of project
B; user X is a writer of project A); a tuple between a user and an object is
what this document calls an _explicit role grant_. Evaluating a relation
means traversing that graph to assert whether it holds (is user X a writer
of project B?), not checking a stored label.

Permissions — the rules for which relation an API call requires — are
implemented as RuleSets on the API routes themselves, not as labels attached
to a relation. A relation isn't a "bundle" of permissions; you can aggregate
every API a relation gates to describe what a user with that relation can
do, but the relation itself is not a collection of those actions.

Application code branches on the _evaluated result_ of a relation check —
the boolean or role returned from an access-check API call against the
resolved target object — never on a persona label, to decide whether a
context can be entered, a route can open, or a write can proceed.

If a page or feature must exist for one audience only, that is a permission
too: model it as a relation in FGA, configure it as the RuleSet for the API
routes that power the page, and wire up permission/access pre-checks in the
UI for early bail-out on page rendering, or for conditionally showing links
into the page (tab, nav, sidebar).

Persona may branch _presentation_ code — which layout, dashboard variant, or
copy renders (layout, emphasis, copy, ordering) — but never an access
decision. A presentation choice is not an access decision, so persona
driving presentation is not an exception to the rule above.

## Terminology: Viewer vs Auditor

The FGA model already distinguishes two different kinds of read access, and
this document uses those names precisely instead of the ambiguous "view
permission":

- **Viewer** — discoverability only. You can tell the thing exists and see
  limited (typically public) data about it, but not privileged data or its
  subordinate/connected objects (participants, formation-stage child
  projects, private documents). Viewer is not ordinarily assigned directly:
  it is conditional on object attributes (public/conditional) or inherited
  from another relation you hold (a committee `member` relation always
  inherits `viewer`, too). Maps to Discovery.
- **Auditor** — privileged read. You get access to privileged data on the
  object itself, as well as its subordinate/connected objects, not just its
  existence. Auditor is what makes a Foundation or Project eligible to
  appear in the selector and be entered as a context.

The app's UI copy today labels the auditor relation "Viewer" in at least one
surface (Org Lens Access role badges and role pickers), while other surfaces
call the same relation "View" or "Review." This document uses "auditor"
throughout regardless of current UI copy, to keep "can the user view this
foundation" (often yes — it's public) distinct from "can the user audit this
foundation" (the permission that actually matters for selector/context
eligibility).

Terminology pass applied throughout this document: everywhere a gate on
selector eligibility or context entry previously said "view permission," it
now reads "auditor or explicit role"; everywhere the meaning was
discoverability only, it reads "viewer/discoverable."

## Why This Is Needed

The product currently blends three things that should stay separate:

1. Can the user view this foundation or project?
2. What engagement or activity (current or past) does the user have with that context?
3. Can the user administer or change things in that context?

Those answers can overlap, but they are not the same.

Examples:

- A Board Member needs foundation governance context without ED-only marketing and metrics.
- A working group chair may need meeting or document operations without foundation-wide authority.
- A Contributor may need useful project context without create/manage actions.
- A user may discover an Akrites package or event from Me without first entering Foundation/Project context.

The app already has contextual writer permission for many create/manage actions, but the current `writerGuard` also has an Executive Director fast path. This document recommends the target model: ED should shape the Foundation experience, while create/manage authority should come from contextual writer permission.

## Current UI Facts

These already work or mostly work today:

- **Me** is the default cross-context workspace.
- **My Dashboard** includes **My Foundations and Projects**, which already acts as a bridge into Foundation/Project contexts.
- Me pages already support cross-context filters such as All Foundations, All Projects, All Groups, All Roles, All Statuses, and All Types.
- Foundation/Project pages already expose writer actions inline, such as Create Meeting, Create Group, Add Mailing List, Create Vote, Create Survey, Create Newsletter, document actions, and Permissions actions.
- Discovery already exists in places like Discover Events.
- Akrites shows the strongest discovery pattern: users can inspect packages and choose **Open for stewardship** from Me without starting in Foundation/Project context.
- Lens access is already derived from writer grants, not persona alone (shipped, PR #1130), and the create picker is a lazy direct-grant tree with search (shipped, PR #1193).
- A backend "what can I create, and where" API covering group/committee targets (LFXV2-2753) was rescoped after #1130 shipped and its ticket status is now Discarded — it is not in progress. There is no committed replacement work item for that API today.
- The Executive Director fast path is still present in `writerGuard` (`writer.guard.ts`) and in `newsletter-access.guard.ts` on `main`: both skip their own permission check for ED persona and let the route open — for meetings, votes, surveys, mailing lists, newsletters, and document create/edit routes. That does not mean the write itself is granted; the UI is subordinate to the API's enforcement, and an ED cannot get project `writer` access just because a guard let the route render. It is very likely a guard bug (a misleading UI-only affordance that a downstream write would then reject) rather than a permission the model grants: `executive_director` does not inherit project `writer`, so none of those general write actions are backed by any ED-inherited relation. Whether this is purely a confusing dead-end (guard says yes, API says no) or an actual gap depends on whether the downstream API independently enforces `writer` for these routes — see the P0 verification ask below. The model does route two _intentional_ marketing permissions through `executive_director` — `marketing_auditor` (read) and `campaign_manager` (write, scoped to Campaigns) — which `PERMISSIONS.md`'s rendered Project table omits entirely, so it looks like ED grants nothing but reads even though the live model (`model.fga`) says otherwise. See Writer Actions and Model Asks below for how the app should check these.

Current confusion:

- The left rail says **Projects** even when the selected context is a foundation.
- Me navigation repeats `My` on most labels even though the active lens already says Me.
- Foundation/Project defaulting can land users in a no-grant context if selector eligibility is not authoritative.
- Discovery contexts can bleed into the Foundation/Project selector, creating clutter and wrong-context landings.

## Target Model

### Me Lens

Me is the user's cross-context workspace.

It should support:

- task switching across contexts
- pending actions
- cross-context meetings, events, groups, votes, surveys, documents, mailing lists, and newsletters
- discovery entry points
- direct jumps into Foundation/Project context

Me pages can support actions when the target context is known.

Rule for row/item actions:

```text
Me item + resolved target object (project, foundation, committee, group)
+ the action-specific grant on that object = allowed create/manage action
```

Rule for create actions:

```text
Me create action + chosen target object (project, foundation, committee, group)
+ the action-specific grant on that object = allowed create/manage action
```

This means Me can be an action workspace, but it is not the authorization context. The resolved target object remains the authority for its action-specific grant check.

The target is usually Foundation/Project and the grant is writer permission, but that's the common case, not the only one. The shipped create flow (PR #1193) also resolves committee/group targets for meetings, surveys, and votes: `writerGuard` accepts `committee.writer` for those three features when a `committee_uid` is present, and accepts `project.meeting_coordinator` for meetings specifically, independent of `project.writer`. A committee writer or meeting coordinator can legitimately hold no direct project-level auditor/writer grant.

Me-originated actions should carry target context:

```text
Me task + target object (project, foundation, committee, group)
+ the action-specific grant on that object = allowed create/manage action
```

Examples:

- **Pending agenda action:** resolve the target group/project/foundation; allow agenda management only if writer permission applies.
- **Meeting card:** open the meeting with its context; edit/manage only if writer permission applies.
- **Vote or survey:** open the item; view/results follow viewer/discoverable eligibility for that item, edit/close follows writer permission.
- **Document row:** open the document context; upload/folder/link actions follow writer permission.
- **Newsletter draft:** open the draft with its target audience context; edit/delete/send follows writer permission for that context.
- **Newsletter create:** ask for the target Foundation/Project and audience first; then apply writer permission.
- **Akrites package:** open package drawer/workflow; stewardship follows Akrites request/stewardship rules.

### Foundation And Project Contexts

Foundation and Project are context views, not persona rewards.

Entry should be based on an authoritative permission grant. Once inside, persona shapes the presentation.

Persona pairs — presentation only, except where noted:

- **Executive Director** in Foundation context maps to **Maintainer** in Project context presentation. Both are context-operator-shaped experiences. They can create/manage only when writer permission is present.
- **Board Member** in Foundation context maps to **Contributor** in Project context presentation. Both are context-participant-shaped experiences. They do not automatically receive create/manage authority.

Of these four, only ED is a real FGA relation (see Terminology and Model Asks
for what it currently grants). Board Member, Contributor, and Maintainer are
inferred/dynamic presentation signals detected from connected data (board
group membership, CDP activity/`cdp_roles`, Insights) — "maintainer," for
instance, is a discrete value the persona-detection service reads off a
`cdp_roles` entry's `role` field, so it is a real value in its _source_
system, just not a Project or Foundation relation in the permissions model.
None of the three exist as an FGA relation on Project or Foundation.

Decision: participant personas (Board Member, Contributor) are
presentation-only. Foundation/Project context entry always requires an
auditor or explicit role grant for that exact context, independent of
persona — persona never opens a context, regardless of which relation (if
any) it happens to correlate with. A user without such a grant does not see
Foundation/Project navigation at all; their experience is Me. This does not
strand them: their own items, meetings, votes, and documents remain fully
usable from Me via item-level eligibility (see Me Lens above), so a
Contributor or Board Member signal without an explicit grant still has a
complete, useful experience — just not a Foundation/Project context to enter.

This means ED is not a synonym for every privileged action, and Maintainer is not a lesser product concept than ED. They are parallel presentation concepts for different context types, but only ED corresponds to any FGA relation today.

### Writer Actions

Do not introduce a separate Admin Mode for Foundation/Project create/manage authority. Admin Mode would imply that EDs, Board Members, Maintainers, or Contributors get a privileged write view because of persona alone, which conflicts with the target model.

LF Staff Mode is a distinct, still-open product question, not a settled requirement. LF Staff already gets `auditor` on every project and foundation through LF Staff Team inheritance (see Model Asks below) — the same broad read access a privileged community member would get if explicitly granted `auditor` on a given foundation. That raises a real question this document does not yet answer: what would "LF Staff Mode" add beyond that? The only candidate that survives the question is write-side — assisted workflows where staff act _on behalf of_ a user or foundation for support/troubleshooting (e.g., fixing a broken meeting or mailing list), which no read relation grants and which a community member's `auditor` grant would not extend to at any scale. Until product defines what, if anything, LF Staff Mode adds, treat it as undefined rather than as a decided model requirement — and it should not replace contextual writer permission for normal Foundation/Project create/manage actions in the meantime.

Keep create/manage actions inline where they belong:

- Create Meeting
- Create Group
- Add Mailing List
- Create Newsletter
- Create Vote
- Create Survey
- Upload File / New Folder / Add Link
- Add User / update role / remove user
- edit, delete, duplicate, assign, manage resources, invite/add people, send/publish

Rule:

```text
Selected Foundation/Project context + writer permission = create/manage affordances
No writer permission = read-only context experience
```

Target-state guard change:

```text
Current writerGuard = Executive Director fast path or canWrite()
Target writerGuard = resolved target context + canWrite()
```

ED-shaped pages gate on the existing named permissions — checked like any other permission, never on a persona guard and never by referencing the `executive_director` relation from application code:

- **Campaigns** checks `campaign_manager` (write-capable; the model currently bundles it into `executive_director` and the `marketing_ops` team).
- **Marketing Impact** checks `marketing_auditor` (read-only; the model currently bundles it into `executive_director`, `marketing_ops`, and parent-project inheritance).
- **Health Metrics** stays ED-gated by design — this page does not migrate to a shared capability (LFXV2-2726 is evaluating an LF Staff answer, not yet started).

None of these three needs a new capability invented for it — the permissions already exist in the model. This migration is tracked in LFXV2-2236 ("Add Marketing Ops UI access (FGA guards)," in review as of this writing) — today, all three pages on `main` still gate solely on `executiveDirectorGuard` (a pure persona check with no FGA lookup). Until that ticket merges, treat "Current UI Facts" as describing the actual state, not this target state.

Whether the `executive_director` relation itself stays in the model, is renamed, or is bundled differently is the platform team's call, not the app's (see Model Asks below) — the app checks `marketing_auditor` and `campaign_manager` directly and does not care which relations feed them. Create/edit/manage routes should not use ED as an authorization shortcut unless the user also has writer permission for the selected target context.

If LF Staff Mode ends up needing to exist as a distinct concept (see the open question above), it should have its own explicit staff eligibility and audit expectations, and should not be inferred from ED, Board Member, Maintainer, Contributor, or writer permission.

### Discovery

Discovery is for finding things outside the user's current contexts. It should create requests, registrations, subscriptions, or workflows, but it should not silently add the context to the Foundation/Project selector unless an auditor or explicit role grant exists.

Selector and Discovery must be separate:

```text
Selector = contexts where I have an authoritative role or auditor grant
Discovery/Browse = contexts or resources I can find, join, register for, request, or inspect
```

Akrites is the clearest example:

```text
Browse packages -> inspect risk/health/provenance -> Open for stewardship
```

Other discovery examples:

- **Events:** find events I am not registered for; register or view details.
- **Meetups:** find community meetups I have not joined; join/register or view details.
- **Akrites:** find packages needing stewardship; open for stewardship.
- **Projects:** find projects/foundations I am not active in; follow, join, request access, or view public profile.
- **Groups:** find public/community groups; join, request membership, or view group details.
- **Mailing lists/newsletters:** find public subscription surfaces; subscribe, request access, or view public archive when available.

## Priorities

### P0: Make Role And Permission Resolution Authoritative

Owner: engineering, with product validation

This is the dependency under selector eligibility, defaulting, writer actions, and discovery separation.

Work needed:

- Normalize one role/permission model across Foundation, Project, Group, and Working Group resources.
- Confirm selector candidates come only from an authoritative auditor/role grant, not broad discovery/search results.
- Confirm APIs enforce auditor and write permission server side before changing `writerGuard` semantics.
- Model group-scoped and working-group-scoped writer permission this cycle.
- Define one role per context everywhere the selector, page header, and role labels are shown.
- Add instrumentation for wrong-context landings, no-grant defaults, selector items without grants, and UI-allowed/API-denied write attempts.

Acceptance:

```text
Authoritative role/permission model = selector eligibility
Discovery/search results != selector eligibility
Group/WG writer scope = explicit model, not foundation-wide fallback
No-grant default count = zero
```

Verify with the platform team that downstream APIs enforce write permission
for affected routes (enforcement lives at the API gateway, external to the
UI, since those APIs serve consumers other than the app); then change
`writerGuard` semantics. `writerGuard` is UI degradation, not the security
boundary — it should not be treated as a blocking gate on its own.

### P1: Preserve My Dashboard As The Context Bridge

Owner: UX / Nuno

What exists:

- My Dashboard already has **My Foundations and Projects**.
- Selecting a row already acts as a bridge into the selected Foundation/Project context.

Work needed:

- Make this bridge obvious and intentional in UX.
- Confirm Foundation rows switch to Foundation context and select the foundation.
- Confirm Project rows switch to Project context and select the project.
- Keep row labels clear about type and role.

Acceptance:

```text
My Foundations and Projects row + selected context = switch to correct context view
```

### P2: Persist Last Valid Context, Then Default By Permission

When a user clicks Foundation or Project context without selecting a specific row, use the last selected valid context first. Highest-permission defaulting is only the cold-start fallback.

Each tier below can contain more than one candidate; the stable sort order is
the tie-breaker _within_ a tier, not a separate tier of its own — API
ordering must never change which context gets selected.

Foundation defaulting order:

1. Keep existing selected foundation if still auditor/role-permitted.
2. Use last selected valid foundation if still auditor/role-permitted.
3. Choose a foundation with a writer/manage grant; if more than one qualifies, pick the first in stable sort order.
4. Otherwise, choose a foundation with an auditor/explicit role grant; if more than one qualifies, pick the first in stable sort order.
5. If none exist, stay in Me/discovery.

Project defaulting order:

1. Keep existing selected project if still auditor/role-permitted.
2. Use last selected valid project if still auditor/role-permitted.
3. Choose a project with a writer/manage grant; if more than one qualifies, pick the first in stable sort order.
4. Otherwise, choose a project with an auditor/explicit role grant; if more than one qualifies, pick the first in stable sort order.
5. If none exist, stay in Me/discovery.

Examples:

- User last selected AAIF and still has an auditor/explicit role grant: Foundation lands on AAIF, even if another foundation has a higher grant.
- User last selected `Goose` and still has an auditor/explicit role grant: Project lands on `Goose`, even if another project has a writer/manage grant.
- Cold start, writer/manage grant on AAIF and auditor grant on LF Europe, no other grants: Foundation lands on AAIF because writer/manage wins.
- Cold start, auditor grants on AAIF and CNCF only, no writer/manage grant anywhere: Foundation lands on first stable auditor-permitted foundation.
- Cold start, writer/manage grant on LF Products, no other foundation grants: Foundation lands on LF Products.
- Cold start, writer/manage grant on `agentgateway` and auditor grant on `Goose`: Project lands on `agentgateway` because writer/manage wins.
- Cold start, auditor grants on six projects, no writer/manage grant anywhere: Project lands on first stable auditor-permitted project.
- Cold start, writer/manage grant on `Goose` only: Project lands on `Goose`.
- Cold start, writer/manage grants on both `agentgateway` and `Goose`, no other grants: Project lands on whichever of the two sorts first in stable order — never on API response order.
- User opens AAIF from My Dashboard: explicit selection wins; switch to Foundation context with AAIF selected.
- User opens `agentgateway` from selector: explicit selection wins; switch to Project context with `agentgateway` selected.
- User loses their grant for selected AAIF mid-session: clear AAIF and re-run defaulting.
- User has no grant-permitted foundations: do not enter empty Foundation context; stay in Me/discovery.
- User has no auditor/explicit role grant for EnerGNN: never default to EnerGNN; show it only in Discovery/Browse if discoverable.

Acceptance:

```text
Candidate contexts + auditor/role permission check = selector items
Context click + last valid selection = selected context
Cold start + highest-grant fallback = selected context
No-grant context = never selected by default
Explicit selection always wins over defaulting
```

### P3: Keep Writer Actions Contextual

Work needed:

- Inventory every create/manage affordance in Foundation/Project pages.
- Confirm each affordance is gated by contextual writer permission.
- Confirm direct create/edit/admin routes are guarded.
- Confirm backend/downstream writes remain authoritative.
- Confirm Me-originated actions resolve target context before applying writer checks.
- Include Meetings, Groups, Mailing Lists, Newsletters, Votes, Surveys, Documents, and Permissions in the inventory.

Acceptance:

```text
Selected Foundation/Project context + writer permission = create/manage affordance visible/enabled
Selected Foundation/Project context + no writer permission = read-only context experience
Me-originated task + target context + writer permission = allowed action
Me create action + selected target context + writer permission = allowed action
```

Regression cases:

- ED/Maintainer with writer permission sees create/manage actions.
- Board Member/Contributor without writer permission does not see create/manage actions.
- User with writer permission but unexpected/no persona signal still sees create/manage actions for that context.
- User who loses writer permission mid-session loses or disables create/manage affordances.
- Direct edit route without writer permission fails closed or redirects.

### P4: Refine Me Navigation Naming

Do this after P1-P3 are settled.

Because the active lens already says **Me**, repeated `My` prefixes are unnecessary.

Recommended label changes:

- My Dashboard -> Dashboard
- My Meetings -> Meetings
- My Events -> Events
- My Meetups -> Meetups
- My Groups -> Groups
- My Mailing Lists -> Mailing Lists
- My Votes -> Votes
- My Surveys -> Surveys
- My Documents -> Documents
- My Newsletters -> Newsletters, if Newsletters appears in Me navigation

Acceptance:

```text
Me nav labels = task nouns
```

### P5: Expand Discovery As Explicit Browse/Join Paths

Work needed:

- Keep discovery separate from Foundation/Project selector eligibility.
- Move no-grant and public discoverable contexts out of the selector and into Browse/Discovery.
- Use explicit user actions such as register, join, follow, request access, subscribe, or open for stewardship.
- Do not silently add discovered contexts to selectors until an auditor or explicit role grant exists.

Acceptance:

```text
Discovery = find something outside current access
Discovery action = explicit request/registration/subscription/workflow
```

## Open Follow-Ups

- Decide whether the left rail should keep separate Foundation and Project buttons or move to one context switcher with grouped context types.
- Align the persona content matrix so ED/Board/Maintainer/Contributor differences remain product experience rules, not authorization shortcuts.
- Add regression tests for read-only users who can view a context but cannot see create/manage affordances.
- Add regression tests for working group chairs who can manage group-level meetings/documents without receiving foundation-wide admin affordances.

## Model Asks (Platform Team)

1. **Permission bundling for ED-derived capabilities — resolved: keep
   `executive_director` as an FGA relation.** The app checks `auditor`,
   `writer`, `marketing_auditor`, and `campaign_manager` directly and never
   branches on the `executive_director` relation itself (see Writer Actions
   above). Per Eric Searcy's review, the relation stays in the model rather
   than being removed or replaced — it remains the bundle that carries
   `auditor`, `marketing_auditor`, and `campaign_manager` for EDs, including
   the one non-staff ED for whom `marketing_auditor`/`campaign_manager`
   aren't available through any other path.

2. **Org lens for LF staff — tracked as LFXV2-2936, not a dangling ask.**
   LF staff should get org-lens switching the same way they get
   project/foundation access today — through team inheritance, not
   impersonation. `PERMISSIONS.md` shows Project's Auditor relation already
   inherits from the global LF Staff Team; the B2B Organization section does
   not have the equivalent inheritance. [LFXV2-2936](https://linuxfoundation.atlassian.net/browse/LFXV2-2936)
   tracks adding an LF Staff Team → B2B Organization auditor inheritance to
   the model — a model change, not a UI workaround.

## Contract Summary

This is the contract this document proposes. Review/approval on the PR is the agreement mechanism.

```text
Authoritative role/permission model -> selector eligibility and defaulting
Context selector eligibility -> auditor or explicit role grant
Sidebar/page/content visibility -> persona (presentation only)
Action authority -> existing contextual writer permission
Campaigns/Marketing Impact -> named capability (campaign_manager/marketing_auditor), not ED persona
Health Metrics -> stays ED-gated by design, pending an LF Staff answer (LFXV2-2726)
Me-originated actions -> carry target context before writer checks
Discovery -> explicit browse/join/request workflows
No separate Admin Mode for Foundation/Project create/manage authority
LF Staff Mode -> open product question, not a decided requirement (LF Staff already has broad auditor via team inheritance)
No-grant contexts -> Browse/Discovery only, never default selection
```
