# Permission and Persona Decision Matrix

Companion matrix for the [Permission, Persona, and Navigation Model](./permission-persona-navigation-model-preread.md).

Use this document to verify how LFX Self Serve should route users, shape pages, and allow actions across Me, Foundation, Project, and Discovery flows.

## Decision Rules

```text
Authoritative role/permission model -> selector eligibility and defaulting
Context selector eligibility -> view permission
Sidebar/page/content visibility -> persona/role
Create/manage authority -> resolved target context + writer permission
Me-originated actions -> carry target context before writer checks
Discovery -> explicit browse/join/request workflows
LF Staff Mode -> explicit staff eligibility for LF operational workflows
No-role contexts -> Browse/Discovery only, never default selection
```

## P0 Gates

### Selector Candidate

- **Input:** Foundation or Project appears as a possible context.
- **Required permission:** Authoritative role or view permission for that exact context.
- **Destination:** Context selector only when permission exists.
- **Allowed actions:** Show in selector with the user's normalized role for that context.
- **Denied actions:** Do not include broad discovery/search results, public contexts, or no-role contexts in the selector.

### Discovery Candidate

- **Input:** Foundation, project, group, event, meetup, package, mailing list, or newsletter is discoverable but not role/view-permitted.
- **Required permission:** Public/discovery eligibility.
- **Destination:** Browse/Discovery surface.
- **Allowed actions:** Register, join, follow, subscribe, request access, inspect, or open stewardship workflow.
- **Denied actions:** Do not treat discovery eligibility as selector eligibility.

### Write Candidate

- **Input:** User attempts create/edit/delete/manage/send/publish.
- **Required permission:** Resolved target context plus server-enforced writer permission.
- **Destination:** Write flow only after UI and API permission checks agree.
- **Allowed actions:** Continue when contextual writer permission passes.
- **Denied actions:** Fail closed if the target context is missing, stale, no-role, or not writer-permitted.

## Context Entry

### User Opens Me

- **Input:** User signs in or clicks Me.
- **Required permission:** Authenticated user.
- **Destination:** Me Dashboard.
- **Visible experience:** Cross-context personal workspace.
- **Allowed actions:** View personal tasks, meetings, events, groups, mailing lists, newsletters, votes, surveys, documents, and discovery entry points.
- **Create/manage rule:** Allowed only after the action resolves or asks for a target Foundation/Project context and writer permission passes.

### User Opens Foundation Without A Selected Foundation

- **Input:** User clicks Foundation/Project lens and chooses Foundation context without selecting a row.
- **Required permission:** At least one view-permitted foundation.
- **Destination:** Last selected valid foundation first; highest-permission eligible foundation only on cold start.
- **Default order:** Existing selected foundation, last selected valid foundation, writer/manage foundation, ED foundation, Board Member foundation, first stable view-permitted foundation.
- **Allowed actions:** Read context data. Create/manage only if writer permission exists for the selected foundation.
- **Denied actions:** Never default into a no-role/no-view foundation. Do not show create/manage because of ED persona alone in the target model.

### User Opens Project Without A Selected Project

- **Input:** User clicks Foundation/Project lens and chooses Project context without selecting a row.
- **Required permission:** At least one view-permitted project.
- **Destination:** Last selected valid project first; highest-permission eligible project only on cold start.
- **Default order:** Existing selected project, last selected valid project, writer/manage project, Maintainer project, Contributor project, first stable view-permitted project.
- **Allowed actions:** Read context data. Create/manage only if writer permission exists for the selected project.
- **Denied actions:** Never default into a no-role/no-view project. Contributor/Maintainer persona alone does not grant create/manage authority.

### User Selects A Specific Foundation Or Project

- **Input:** User selects a row from My Foundations and Projects or picks a selector item.
- **Required permission:** View permission for that specific context.
- **Destination:** Explicitly selected Foundation/Project context.
- **Allowed actions:** Explicit selection wins over defaulting. Create/manage follows writer permission for the selected context.
- **Denied actions:** If view permission is missing or lost, clear selection and re-run defaulting.

## Me Lens Actions

### Existing Item Action From Me

- **Read examples:** View meeting details, view vote results, view survey results, open document, view sent newsletter.
- **Write examples:** Edit a meeting, manage agenda, update survey, manage document, edit newsletter draft.
- **Required permission:** View permission or item eligibility for read actions. Writer permission for the item's resolved target context for write actions.
- **Destination:** Stay in Me or open the item detail/drawer with target context attached.
- **Allowed actions:** Read actions follow item eligibility. Create/manage actions are visible or enabled when writer permission passes.
- **Denied actions:** If writer permission fails, keep eligible view/read actions only.

### Create Action From Me

- **Example:** Create Meeting, Create Group, Add Mailing List, Create Newsletter, Create Vote, Create Survey, Upload File, Add Link.
- **Required permission:** User must choose a target Foundation/Project context, then writer permission must pass for that target.
- **Destination:** Create flow scoped to the chosen target context.
- **Allowed actions:** Continue to create form after target context and writer permission are confirmed.
- **Denied actions:** Do not create against an implicit/global Me context.

### Pending Action From Me

- **Example:** Review agenda, review materials, respond to governance action.
- **Required permission:** View permission for the pending item. Writer permission only for actions that modify the target context.
- **Destination:** Pending action detail or target context.
- **Allowed actions:** View/complete personal response actions when eligible. Manage shared resources only with writer permission.
- **Denied actions:** Do not expose target-context management controls when writer permission is absent.

## Persona Scenarios

### ED For Foundation With Writer Permission

- **Context:** Foundation.
- **Persona:** Executive Director.
- **Required permission:** Foundation view permission and writer permission.
- **Visible experience:** ED-shaped Foundation experience, including ED-only sections where applicable.
- **Allowed actions:** Create/manage Foundation resources.
- **Denied actions:** None beyond normal context/resource constraints.

### ED For Foundation Without Writer Permission

- **Context:** Foundation.
- **Persona:** Executive Director.
- **Required permission:** Foundation view permission.
- **Visible experience:** ED-shaped Foundation experience.
- **Allowed actions:** Read ED-context pages where persona allows.
- **Denied actions:** Create/edit/manage routes and affordances in the target model.

### Board Member With Writer Permission

- **Context:** Foundation.
- **Persona:** Board Member.
- **Required permission:** Foundation view permission and writer permission.
- **Visible experience:** Board/governance-shaped Foundation experience.
- **Allowed actions:** Create/manage resources covered by writer permission.
- **Denied actions:** ED-only pages such as ED metrics or marketing pages unless separately allowed.

### Board Member Without Writer Permission

- **Context:** Foundation.
- **Persona:** Board Member.
- **Required permission:** Foundation view permission.
- **Visible experience:** Board/governance-shaped Foundation experience.
- **Allowed actions:** Read governance context and participate where eligible.
- **Denied actions:** Create/manage resources.

### Maintainer With Writer Permission

- **Context:** Project.
- **Persona:** Maintainer.
- **Required permission:** Project view permission and writer permission.
- **Visible experience:** Maintainer-shaped Project experience.
- **Allowed actions:** Create/manage Project resources.
- **Denied actions:** Foundation-only ED pages and actions.

### Maintainer Without Writer Permission

- **Context:** Project.
- **Persona:** Maintainer.
- **Required permission:** Project view permission.
- **Visible experience:** Maintainer-shaped Project experience.
- **Allowed actions:** Read Project context.
- **Denied actions:** Create/manage resources in the target model.

### Contributor With Writer Permission

- **Context:** Project.
- **Persona:** Contributor.
- **Required permission:** Project view permission and writer permission.
- **Visible experience:** Contributor-shaped Project experience.
- **Allowed actions:** Create/manage resources covered by writer permission.
- **Denied actions:** Maintainer-only content if any page is intentionally persona-shaped.

### Contributor Without Writer Permission

- **Context:** Project.
- **Persona:** Contributor.
- **Required permission:** Project view permission.
- **Visible experience:** Contributor-shaped Project experience.
- **Allowed actions:** Read Project context and participate where eligible.
- **Denied actions:** Create/manage resources.

### LF Staff Mode

- **Context:** Staff operational mode, not a Foundation/Project persona.
- **Persona:** LF Staff.
- **Required permission:** Explicit staff eligibility.
- **Visible experience:** Staff support, troubleshooting, oversight, assisted workflows, and cross-foundation operations.
- **Allowed actions:** Staff-only operations defined for LF workflows.
- **Denied actions:** Do not use LF Staff Mode as a substitute for normal Foundation/Project writer permission unless the workflow is explicitly staff-owned and audited.

## Feature Decisions

### Meetings

- **Me:** Show cross-context meetings and personal meeting actions.
- **Foundation/Project:** Show context-scoped meetings.
- **Create/manage:** Requires target context plus writer permission.
- **Read-only:** User can view/join/RSVP where eligible, but cannot edit, delete, invite as manager, or manage resources.

### Groups

- **Me:** Show groups the user belongs to across contexts.
- **Foundation/Project:** Show context-scoped groups.
- **Create/manage:** Requires target context plus writer permission.
- **Read-only:** User can view group details where allowed, but cannot create, edit, delete, or manage membership.

### Mailing Lists

- **Me:** Show subscribed or accessible mailing lists across contexts.
- **Foundation/Project:** Show context-scoped mailing lists.
- **Create/manage:** Requires target context plus writer permission.
- **Read-only:** User can view or subscribe where allowed, but cannot add, edit, or administer lists.

### Newsletters

- **Me:** Show drafts or sent newsletters relevant to the user when exposed in Me.
- **Foundation/Project:** Show context-scoped newsletters.
- **Create/manage:** Requires target context plus writer permission.
- **Read-only:** User can view sent newsletters where allowed, but cannot create, edit, delete, send, or publish.

### Votes

- **Me:** Show votes the user has been invited to or can view across contexts.
- **Foundation/Project:** Show context-scoped votes.
- **Create/manage:** Requires target context plus writer permission.
- **Read-only:** User can vote or view results when eligible, but cannot create, edit, close, or delete votes.

### Surveys

- **Me:** Show surveys the user has been invited to or can view across contexts.
- **Foundation/Project:** Show context-scoped surveys.
- **Create/manage:** Requires target context plus writer permission.
- **Read-only:** User can respond or view allowed results, but cannot create, edit, close, or delete surveys.

### Documents

- **Me:** Show documents, links, and attachments across contexts.
- **Foundation/Project:** Show context-scoped document library.
- **Create/manage:** Requires target context plus writer permission.
- **Read-only:** User can open allowed documents, but cannot upload, create folders, add links, edit, or delete.

### Permissions

- **Me:** No global Me permission administration.
- **Foundation/Project:** Show permissions for selected context when allowed.
- **Create/manage:** Requires selected context plus writer permission.
- **Read-only:** User can see a read-only permission view only if product intentionally exposes it.

## Discovery Decisions

### Discover Events

- **Input:** User browses events outside current contexts.
- **Required permission:** Public/event discovery eligibility.
- **Destination:** Event detail or registration flow.
- **Allowed actions:** Register, view details, request help.
- **Denied actions:** Do not add Foundation/Project selector access unless view permission is granted.

### Discover Meetups

- **Input:** User browses meetups outside joined communities.
- **Required permission:** Public/community discovery eligibility.
- **Destination:** Meetup detail or join/register flow.
- **Allowed actions:** Join/register, view details.
- **Denied actions:** Do not grant context writer access.

### Discover Akrites Packages

- **Input:** User browses package risk/health/provenance.
- **Required permission:** Akrites discovery eligibility.
- **Destination:** Package drawer or stewardship workflow.
- **Allowed actions:** Inspect package, open for stewardship.
- **Denied actions:** Do not add Foundation/Project selector access unless separate context permission exists.

### Discover Projects Or Foundations

- **Input:** User finds a project/foundation outside active membership.
- **Required permission:** Public profile or discovery eligibility.
- **Destination:** Public profile, follow/join/request access flow.
- **Allowed actions:** Follow, join, request access, view public profile.
- **Denied actions:** Do not expose private context pages until view permission exists.

### Discover Groups

- **Input:** User finds public/community groups.
- **Required permission:** Public group or discovery eligibility.
- **Destination:** Group detail, join, or request membership flow.
- **Allowed actions:** Join, request membership, view allowed details.
- **Denied actions:** Do not expose group management controls without writer permission.

### Discover Mailing Lists Or Newsletters

- **Input:** User finds public subscription surfaces.
- **Required permission:** Public list/newsletter discovery eligibility.
- **Destination:** Subscribe, request access, or public archive flow.
- **Allowed actions:** Subscribe, request access, view public archive when available.
- **Denied actions:** Do not expose list/newsletter administration without target context and writer permission.

## Edge Cases

### User Has No View-Permitted Foundations

- **Input:** User clicks Foundation context.
- **Destination:** Stay in Me or Discovery.
- **Allowed actions:** Show discovery/request paths.
- **Denied actions:** Do not enter an empty Foundation shell.

### User Has A Discoverable But No-Role Foundation

- **Input:** User can discover a foundation but has no authoritative role/view permission.
- **Destination:** Browse/Discovery only.
- **Allowed actions:** View public profile or request access if available.
- **Denied actions:** Do not include it in selector and never default to it.

### User Has No View-Permitted Projects

- **Input:** User clicks Project context.
- **Destination:** Stay in Me or Discovery.
- **Allowed actions:** Show discovery/request paths.
- **Denied actions:** Do not enter an empty Project shell.

### User Has A Discoverable But No-Role Project

- **Input:** User can discover a project but has no authoritative role/view permission.
- **Destination:** Browse/Discovery only.
- **Allowed actions:** View public profile, follow, join, or request access if available.
- **Denied actions:** Do not include it in selector and never default to it.

### User Loses View Permission Mid-Session

- **Input:** Selected context becomes unavailable.
- **Destination:** Clear selection and re-run defaulting.
- **Allowed actions:** Continue only in eligible context.
- **Denied actions:** Do not keep stale context data or actions available.

### User Loses Writer Permission Mid-Session

- **Input:** Selected context remains viewable but writer access is revoked.
- **Destination:** Stay in selected context as read-only.
- **Allowed actions:** Read-only actions.
- **Denied actions:** Hide/disable create/manage affordances and fail direct write routes closed.

### Direct Create/Edit URL

- **Input:** User opens a create/edit/admin route directly.
- **Required permission:** Resolved target context plus writer permission.
- **Destination:** Requested route only if writer check passes.
- **Allowed actions:** Continue if authorized.
- **Denied actions:** Redirect or fail closed if target context is missing or writer permission fails.

## Operational Metrics

Track these so the team can prove the model is working:

- **Wrong-context landing:** user lands in a context different from explicit or persisted valid selection.
- **No-role default:** user defaults into a context without authoritative role/view permission. Target: zero.
- **Selector no-role item:** selector shows a context without authoritative role/view permission. Target: zero.
- **UI-allowed/API-denied write:** UI showed or enabled a write action that the API denied for permission. Target: zero after rollout.
- **Multiple role labels per context:** one context shows conflicting roles in selector, page header, or resource rows. Target: zero.
