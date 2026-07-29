# Permission, Persona, and Navigation Model

Working spec for aligning how the LFX Self Serve experience in this repo decides where users can go, what they see, and what they can do.

## TL;DR

Separate the product model into four decisions:

- **Where can I go?** An auditor or explicit role grant controls Foundation/Project context eligibility.
- **What is my role there?** Persona and role shape navigation, dashboards, sections, and metrics.
- **What can I do there?** Contextual writer permission controls create/manage actions.
- **What can I discover?** Discovery surfaces let users find events, meetups, packages, projects, foundations, groups, and subscription surfaces outside their current contexts.

The key rule:

```text
Context access is not action authority.
Every gate is a permission check.
Persona shapes presentation only.
Roles are grant bundles in the FGA model, never branches in code.
```

## Core Principle

Roles and personas exist only in the authorization model (OpenFGA). A role is
a named bundle of permissions. Permissions are assigned to roles; roles are
assigned to users. Application code never branches on role or persona to make
a decision.

Every product decision — can this context appear in the selector, can this
route open, can this affordance render, can this write proceed — is answered
by a permission check against the resolved target object. The app consumes
capabilities, not identities.

If a page or feature must exist for one audience only, that is a permission
too: model it as a relation/capability in FGA, grant it to the appropriate
role, and check the capability.

Persona may shape presentation (layout, emphasis, copy, ordering) but never
grants, denies, or gates anything — including reads.

## Terminology: Viewer vs Auditor

The FGA model already distinguishes two different kinds of read access, and
this document uses those names precisely instead of the ambiguous "view
permission":

- **Viewer** — discoverability only. You can tell the thing exists (a public
  meeting, an active project) but you do not get access to what is inside it
  (participants, formation-stage child projects, private documents). Viewer
  is not ordinarily assigned directly: it is conditional on object attributes
  (public/conditional) or inherited from another role you hold (a committee
  `member` role always inherits `viewer`, too). Maps to Discovery.
- **Auditor** — privileged read. You get access to the private data "inside"
  the object, not just its existence. Auditor is what makes a Foundation or
  Project eligible to appear in the selector and be entered as a context.

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
2. What relationship does the user have to that context?
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
- The Executive Director fast path is still present in `writerGuard` (`writer.guard.ts`) and in `newsletter-access.guard.ts` on `main` — both grant **write** access unconditionally to ED persona. Per `PERMISSIONS.md` (the live permissions model), the `Executive Director` relation only grants view/read rows, never a write-granting row. Granting write through this fast path is very likely a bug, not a deliberate model choice, and is tracked separately for removal rather than treated as an open design question.

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
Me item + resolved target Foundation/Project context + writer permission = allowed create/manage action
```

Rule for create actions:

```text
Me create action + chosen target Foundation/Project context + writer permission = allowed create/manage action
```

This means Me can be an action workspace, but it is not the authorization context. The target Foundation/Project remains the authority for writer checks.

Me-originated actions should carry target context:

```text
Me task + target Foundation/Project context + writer permission = allowed create/manage action
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

Entry should be based on an authoritative role/permission model. Once inside, role/persona shapes the experience.

Role pairs — and a critical distinction between them:

- **Executive Director** in Foundation context maps to **Maintainer** in Project context. Both are context operator experiences. They can create/manage only when writer permission is present.
- **Board Member** in Foundation context maps to **Contributor** in Project context. Both are context participant experiences. They do not automatically receive create/manage authority.

Of these four, only ED is a real FGA relation. Board Member, Contributor, and
Maintainer are inferred/dynamic signals detected from connected data (board
group membership, CDP activity, Insights), not discrete roles anywhere in LFX
data. There is no "Board Member" or "Maintainer" relation on Project or
Foundation in the permissions model.

Decision: participant personas (Board Member, Contributor) are
presentation-only. Foundation/Project context entry always requires an
auditor or explicit role grant for that exact context — persona never opens
a context. A user without such a grant does not see Foundation/Project
navigation at all; their experience is Me. This does not strand them: their
own items, meetings, votes, and documents remain fully usable from Me via
item-level eligibility (see Me Lens above), so a Contributor or Board Member
signal without an explicit grant still has a complete, useful experience —
just not a Foundation/Project context to enter.

This means ED is not a synonym for every privileged action, and Maintainer is not a lesser product concept than ED. They are parallel operating roles for different context types, but only ED carries any actual permission weight today.

### Writer Actions

Do not introduce a separate Admin Mode for Foundation/Project create/manage authority. Admin Mode would imply that EDs, Board Members, Maintainers, or Contributors get a privileged write view because of persona alone, which conflicts with the target model.

LF Staff Mode is different and may still be needed. LF Staff Mode should cover Linux Foundation operational workflows across contexts, such as support, troubleshooting, staff-only oversight, assisted workflows, and cross-foundation operations. It should not replace contextual writer permission for normal Foundation/Project create/manage actions.

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

ED-shaped pages (Health Metrics, Campaigns) require a named capability checked like any other permission — not a persona guard. This is an open model decision, not yet resolved: either FGA keeps an ED (or a successor relation, e.g. `foundation_insights_viewer`) that carries the capability these pages check, or the pages open to all auditors. Removing the ED relation while keeping ED-gated pages would force persona-checking back into the UI, which is exactly what this document argues against — so the relation-removal question and the ED-page-gating question have to be resolved together (see Model Asks below). Create/edit/manage routes should not use ED as an authorization shortcut unless the user also has writer permission for the selected target context.

LF Staff Mode should have its own explicit staff eligibility and audit expectations. It should not be inferred from ED, Board Member, Maintainer, Contributor, or writer permission.

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

Foundation defaulting order:

1. Keep existing selected foundation if still auditor/role-permitted.
2. Use last selected valid foundation if still auditor/role-permitted.
3. Choose a foundation where the user has a writer/manage grant.
4. Choose a foundation where the user has an auditor/explicit role grant.
5. Choose first grant-permitted foundation in stable sort order.
6. If none exist, stay in Me/discovery.

Project defaulting order:

1. Keep existing selected project if still auditor/role-permitted.
2. Use last selected valid project if still auditor/role-permitted.
3. Choose a project where the user has a writer/manage grant.
4. Choose a project where the user has an auditor/explicit role grant.
5. Choose first grant-permitted project in stable sort order.
6. If none exist, stay in Me/discovery.

Examples:

- User last selected AAIF and still has an auditor/explicit role grant: Foundation lands on AAIF, even if another foundation has a higher grant.
- User last selected `Goose` and still has an auditor/explicit role grant: Project lands on `Goose`, even if another project has a writer/manage grant.
- Cold start, writer/manage grant on AAIF and auditor grant on LF Europe, no other grants: Foundation lands on AAIF because writer/manage wins.
- Cold start, auditor grants on AAIF and CNCF only, no writer/manage grant anywhere: Foundation lands on first stable auditor-permitted foundation.
- Cold start, writer/manage grant on LF Products, no other foundation grants: Foundation lands on LF Products.
- Cold start, writer/manage grant on `agentgateway` and auditor grant on `Goose`: Project lands on `agentgateway` because writer/manage wins.
- Cold start, auditor grants on six projects, no writer/manage grant anywhere: Project lands on first stable auditor-permitted project.
- Cold start, writer/manage grant on `Goose` only: Project lands on `Goose`.
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

Two open questions in the FGA model, not the UI, that this document depends on:

1. **Decision on the ED relation.** Today `Executive Director` is a real FGA
   relation on Project, but it only grants auditor/read — it is redundant
   with LF-staff-inherited auditor everywhere except one project that has a
   non-staff ED. Removal is acceptable provided that one non-staff ED
   receives a direct auditor grant, and provided ED-shaped pages (Health
   Metrics, Campaigns) get a named capability instead of depending on the ED
   relation (see Writer Actions above).
2. **Org lens for LF staff.** LF staff should get org-lens switching the same
   way they get project/foundation access today — through team inheritance,
   not impersonation. `PERMISSIONS.md` shows Project's Auditor relation
   already inherits from the global LF Staff Team; the B2B Organization
   section does not have the equivalent inheritance. This needs an LF Staff
   Team → B2B Organization auditor inheritance added to the model — a model
   change, not a UI workaround.

## Meeting Ask

Can we agree on this contract?

```text
Authoritative role/permission model -> selector eligibility and defaulting
Context selector eligibility -> auditor or explicit role grant
Sidebar/page/content visibility -> persona (presentation only)
Action authority -> existing contextual writer permission
ED-shaped pages -> named capability, not ED persona
Me-originated actions -> carry target context before writer checks
Discovery -> explicit browse/join/request workflows
No separate Admin Mode for Foundation/Project create/manage authority
LF Staff Mode may still be needed for LF operational workflows
No-grant contexts -> Browse/Discovery only, never default selection
```
