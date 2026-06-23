# Permission, Persona, and Navigation Model

Working spec for aligning how the LFX Self Serve experience in this repo decides where users can go, what they see, and what they can do.

## TL;DR

Separate the product model into four decisions:

- **Where can I go?** View permission controls Foundation/Project context eligibility.
- **What is my role there?** Persona and role shape navigation, dashboards, sections, and metrics.
- **What can I do there?** Contextual writer permission controls create/manage actions.
- **What can I discover?** Discovery surfaces let users find events, meetups, packages, projects, foundations, groups, and subscription surfaces outside their current contexts.

The key rule:

```text
Context access is not action authority.
Persona shapes experience.
Writer permission controls create/manage actions.
```

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

Current confusion:

- The left rail says **Projects** even when the selected context is a foundation.
- Me navigation repeats `My` on most labels even though the active lens already says Me.
- Foundation/Project defaulting needs to land users in the highest-permission relevant context.

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
- **Vote or survey:** open the item; view/results follow view permission, edit/close follows writer permission.
- **Document row:** open the document context; upload/folder/link actions follow writer permission.
- **Newsletter draft:** open the draft with its target audience context; edit/delete/send follows writer permission for that context.
- **Newsletter create:** ask for the target Foundation/Project and audience first; then apply writer permission.
- **Akrites package:** open package drawer/workflow; stewardship follows Akrites request/stewardship rules.

### Foundation And Project Contexts

Foundation and Project are context views, not persona rewards.

Entry should be based on view permission. Once inside, role/persona shapes the experience.

Role pairs:

- **Executive Director** in Foundation context maps to **Maintainer** in Project context. Both are context operator experiences. They can create/manage only when writer permission is present.
- **Board Member** in Foundation context maps to **Contributor** in Project context. Both are context participant experiences. They do not automatically receive create/manage authority.

This means ED is not a synonym for every privileged action, and Maintainer is not a lesser product concept than ED. They are parallel operating roles for different context types.

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

ED-only pages can still use persona guards where the page itself is an ED experience, such as Health Metrics or Campaigns. Create/edit/manage routes should not use ED as an authorization shortcut unless the user also has writer permission for the selected target context.

LF Staff Mode should have its own explicit staff eligibility and audit expectations. It should not be inferred from ED, Board Member, Maintainer, Contributor, or writer permission.

### Discovery

Discovery is for finding things outside the user's current contexts. It should create requests, registrations, subscriptions, or workflows, but it should not silently add the context to the Foundation/Project selector unless view permission is granted.

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

### P2: Default To The Highest-Permission Context

When a user clicks Foundation or Project context without selecting a specific row, land them in the highest-permission eligible context of that type.

Foundation defaulting order:

1. Keep existing selected foundation if still view-permitted.
2. Choose a foundation where the user has writer/manage access.
3. Choose Executive Director foundation if view-permitted.
4. Choose Board Member foundation if view-permitted.
5. Choose first view-permitted foundation in stable sort order.
6. If none exist, stay in Me/discovery.

Project defaulting order:

1. Keep existing selected project if still view-permitted.
2. Choose a project where the user has writer/manage access.
3. Choose Maintainer project if view-permitted.
4. Choose Contributor project if view-permitted.
5. Choose first view-permitted project in stable sort order.
6. If none exist, stay in Me/discovery.

Examples:

- ED for AAIF and Board Member for LF Europe: Foundation lands on AAIF.
- Board Member for AAIF and CNCF, no ED role: Foundation lands on the most recently selected Board foundation, otherwise first stable item.
- Foundation writer/manage on LF Products but no ED persona: Foundation lands on LF Products because writer/manage wins.
- Maintainer for `agentgateway` and Contributor for `Goose`: Project lands on `agentgateway`.
- Contributor for six projects, no Maintainer role: Project lands on the most recently selected Contributor project, otherwise first stable item.
- Project writer/manage on `Goose` but only Contributor persona signals: Project lands on `Goose` because writer/manage wins.
- User opens AAIF from My Dashboard: explicit selection wins; switch to Foundation context with AAIF selected.
- User opens `agentgateway` from selector: explicit selection wins; switch to Project context with `agentgateway` selected.
- User loses view permission for selected AAIF mid-session: clear AAIF and re-run defaulting.
- User has no view-permitted foundations: do not enter empty Foundation context; stay in Me/discovery.

Acceptance:

```text
Candidate contexts + view permission check = selector items
Context click + highest-permission default = selected context
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
- Use explicit user actions such as register, join, follow, request access, subscribe, or open for stewardship.
- Do not silently add discovered contexts to selectors until view permission exists.

Acceptance:

```text
Discovery = find something outside current access
Discovery action = explicit request/registration/subscription/workflow
```

## Open Follow-Ups

- Confirm whether upstream query/resource APIs already enforce view permission; if not, add explicit batch view checks.
- Decide whether the left rail should keep separate Foundation and Project buttons or move to one context switcher with grouped context types.
- Align the persona content matrix so ED/Board/Maintainer/Contributor differences remain product experience rules, not authorization shortcuts.
- Add regression tests for read-only users who can view a context but cannot see create/manage affordances.
- Add regression tests for working group chairs who can manage group-level meetings/documents without receiving foundation-wide admin affordances.

## Meeting Ask

Can we agree on this contract?

```text
Context selector eligibility -> view permission
Sidebar/page/content visibility -> persona/role
Action authority -> existing contextual writer permission
Me-originated actions -> carry target context before writer checks
Discovery -> explicit browse/join/request workflows
No separate Admin Mode for Foundation/Project create/manage authority
LF Staff Mode may still be needed for LF operational workflows
```
