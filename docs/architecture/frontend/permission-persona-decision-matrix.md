# Permission and Persona Decision Matrix

Companion matrix for the [Permission, Persona, and Navigation Model](./permission-persona-navigation-model-preread.md).

Use this document to verify how LFX Self Serve should route users, shape pages, and allow actions across Me, Foundation, Project, and Discovery flows.

## Decision Rules

```text
Authoritative role/permission model -> selector eligibility and defaulting
Context selector eligibility -> auditor or explicit role grant
Data/page visibility -> permission (auditor/explicit role or named capability)
Layout, emphasis, copy, ordering -> persona (presentation only)
Create/manage authority -> resolved target object + the action-specific relation it requires (often writer, not always)
Me-originated actions -> carry target object before permission checks
Discovery -> explicit browse/join/request workflows
LF Staff Mode -> open product question, not a decided requirement (see preread)
No-grant contexts -> Browse/Discovery only, never default selection
```

## P0 Gates

### Selector Candidate

- **Input:** Foundation or Project appears as a possible context.
- **Required permission:** Auditor or explicit role grant for that exact context.
- **Destination:** Context selector only when permission exists.
- **Allowed actions:** Show in selector with the user's normalized role for that context.
- **Denied actions:** Do not include broad discovery/search results, public contexts, or no-grant contexts in the selector.

### Discovery Candidate

- **Input:** Foundation, project, group, event, meetup, package, mailing list, or newsletter is discoverable but the user holds no auditor/explicit role grant for it.
- **Required permission:** Public/discovery eligibility.
- **Destination:** Browse/Discovery surface.
- **Allowed actions:** Register, join, follow, subscribe, request access, inspect, or open stewardship workflow.
- **Denied actions:** Do not treat discovery eligibility as selector eligibility.

### Write Candidate

- **Input:** User attempts create/edit/delete/manage/send/publish.
- **Required permission:** Resolved target context plus server-enforced writer permission.
- **Destination:** Write flow only after UI and API permission checks agree.
- **Allowed actions:** Continue when contextual writer permission passes.
- **Denied actions:** Fail closed if the target context is missing, stale, no-grant, or not writer-permitted.

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
- **Required permission:** At least one auditor/explicit-role-permitted foundation.
- **Destination:** Last selected valid foundation first; highest-grant eligible foundation only on cold start.
- **Default order:** Existing selected foundation (if still auditor/role-permitted), last selected valid foundation (if still auditor/role-permitted), foundation with a writer/manage grant (stable sort order breaks ties among multiple), otherwise foundation with an auditor/explicit role grant (stable sort order breaks ties), none -> stay in Me/discovery.
- **Allowed actions:** Read context data. Create/manage only if writer permission exists for the selected foundation.
- **Denied actions:** Never default into a no-grant foundation. Do not show create/manage because of persona alone in the target model.

### User Opens Project Without A Selected Project

- **Input:** User clicks Foundation/Project lens and chooses Project context without selecting a row.
- **Required permission:** At least one auditor/explicit-role-permitted project.
- **Destination:** Last selected valid project first; highest-grant eligible project only on cold start.
- **Default order:** Existing selected project (if still auditor/role-permitted), last selected valid project (if still auditor/role-permitted), project with a writer/manage grant (stable sort order breaks ties among multiple), otherwise project with an auditor/explicit role grant (stable sort order breaks ties), none -> stay in Me/discovery.
- **Allowed actions:** Read context data. Create/manage only if writer permission exists for the selected project.
- **Denied actions:** Never default into a no-grant project. Contributor/Maintainer persona alone does not grant create/manage authority or context entry.

### User Selects A Specific Foundation Or Project

- **Input:** User selects a row from My Foundations and Projects or picks a selector item.
- **Required permission:** Auditor or explicit role grant for that specific context.
- **Destination:** Explicitly selected Foundation/Project context.
- **Allowed actions:** Explicit selection wins over defaulting. Create/manage follows writer permission for the selected context.
- **Denied actions:** If the auditor/explicit role grant is missing or lost, clear selection and re-run defaulting.

## Me Lens Actions

### Existing Item Action From Me

- **Read examples:** View meeting details, view vote results, view survey results, open document, view sent newsletter.
- **Write examples:** Edit a meeting, manage agenda, update survey, manage document, edit newsletter draft.
- **Required permission:** Viewer/discoverable eligibility or item eligibility for read actions. The action-specific grant on the item's resolved target object for write actions — writer permission for a Foundation/Project target, or committee writer / meeting coordinator when the target resolves to a committee or group.
- **Destination:** Stay in Me or open the item detail/drawer with target context attached.
- **Allowed actions:** Read actions follow item eligibility. Create/manage actions are visible or enabled when writer permission passes.
- **Denied actions:** If writer permission fails, keep eligible view/read actions only.

### Create Action From Me

- **Example:** Create Meeting, Create Group, Add Mailing List, Create Newsletter, Create Vote, Create Survey, Upload File, Add Link.
- **Required permission:** User must choose a target object (project, foundation, committee, or group), then the action-specific grant on that object must pass. For most creates the target is Foundation/Project and the grant is writer permission. For Create Meeting, Create Survey, and Create Vote, the target can also be a committee/group, authorized by `committee.writer`; Create Meeting alone can also be authorized by `project.meeting_coordinator` without project writer.
- **Destination:** Create flow scoped to the chosen target context.
- **Allowed actions:** Continue to create form after target context and its action-specific grant are confirmed.
- **Denied actions:** Do not create against an implicit/global Me context.

### Pending Action From Me

- **Example:** Review agenda, review materials, respond to governance action.
- **Required permission:** Viewer/discoverable eligibility for the pending item. Writer permission only for actions that modify the target context.
- **Destination:** Pending action detail or target context.
- **Allowed actions:** View/complete personal response actions when eligible. Manage shared resources only with writer permission.
- **Denied actions:** Do not expose target-context management controls when writer permission is absent.

## Presentation Scenarios

Persona changes what the experience looks like (layout, emphasis, copy,
ordering). It never decides whether the user can enter the context, read its
data, or write to it — those outcomes are stated below purely in permission
terms (auditor grant, writer grant, named capability).

### ED-Shaped Foundation With Writer Grant

- **Context:** Foundation.
- **Presentation:** ED-shaped Foundation experience, including ED-only sections where a named capability backs them.
- **Required permission:** Auditor grant on the foundation, plus a writer grant.
- **Allowed actions:** Create/manage Foundation resources.
- **Denied actions:** None beyond normal context/resource constraints.

### ED-Shaped Foundation Without Writer Grant

- **Context:** Foundation.
- **Presentation:** ED-shaped Foundation experience.
- **Required permission:** Auditor grant on the foundation. No writer grant.
- **Allowed actions:** Read ED-shaped pages only where the named capability
  behind them (see Model Asks in the preread) is granted — not because the ED
  persona is detected.
- **Denied actions:** Create/edit/manage routes and affordances.

### Board-Shaped Foundation Presentation With Writer Grant

- **Context:** Foundation.
- **Presentation:** Board/governance-shaped Foundation experience.
- **Required permission:** Auditor grant on the foundation, plus a writer grant.
- **Allowed actions:** Create/manage resources covered by the writer grant.
- **Denied actions:** ED-shaped pages unless the named capability behind them is separately granted.

### Board-Shaped Foundation Presentation Without Writer Grant

- **Context:** Foundation.
- **Presentation:** Board/governance-shaped Foundation experience.
- **Required permission:** Auditor grant on the foundation. No writer grant.
- **Allowed actions:** Read governance context and participate where eligible.
- **Denied actions:** Create/manage resources.
- **Note:** the Board Member presentation signal does not itself grant the
  auditor access this scenario assumes — without an auditor/explicit role
  grant, this user has no Foundation context at all (see Context Entry
  above) and works from Me instead.
- **Regression case:** a user with a Board Member presentation signal but no
  auditor/explicit role grant on the foundation never sees it in the
  Foundation selector and is never defaulted into it.

### Maintainer-Shaped Project Presentation With Writer Grant

- **Context:** Project.
- **Presentation:** Maintainer-shaped Project experience.
- **Required permission:** Auditor grant on the project, plus a writer grant.
- **Allowed actions:** Create/manage Project resources.
- **Denied actions:** Foundation-only ED-shaped pages and actions.

### Maintainer-Shaped Project Presentation Without Writer Grant

- **Context:** Project.
- **Presentation:** Maintainer-shaped Project experience.
- **Required permission:** Auditor grant on the project. No writer grant.
- **Allowed actions:** Read Project context.
- **Denied actions:** Create/manage resources.

### Contributor-Shaped Project Presentation With Writer Grant

- **Context:** Project.
- **Presentation:** Contributor-shaped Project experience.
- **Required permission:** Auditor grant on the project, plus a writer grant.
- **Allowed actions:** Create/manage resources covered by the writer grant.
- **Denied actions:** Maintainer-only content if any page is intentionally persona-shaped.

### Contributor-Shaped Project Presentation Without Writer Grant

- **Context:** Project.
- **Presentation:** Contributor-shaped Project experience.
- **Required permission:** Auditor grant on the project. No writer grant.
- **Allowed actions:** Read Project context and participate where eligible.
- **Denied actions:** Create/manage resources.
- **Note:** same caveat as Board Member above — the Contributor signal alone
  does not grant Foundation/Project context entry; most contributors should
  not be auditors, and without a grant this user's experience is Me only.
- **Regression case:** a user with a Contributor presentation signal but no
  auditor/explicit role grant on the project never sees it in the Project
  selector and is never defaulted into it.

### LF Staff Mode (Open Question)

- **Context:** Not a decided scenario — see the preread's Writer Actions section. LF Staff already holds `auditor` on every project/foundation via LF Staff Team inheritance, the same read access a community member gets with an explicit `auditor` grant. What "LF Staff Mode" would add beyond that read access is undefined.
- **Candidate answer:** if this ends up being built, the only thing that would actually distinguish it is write-side assisted-workflow capability (acting on behalf of a user/foundation for support), which no read relation grants.
- **Denied actions:** Do not use "LF Staff Mode" as a substitute for normal Foundation/Project writer permission, and do not build it against an undefined requirement.

## Feature Decisions

### Meetings

- **Me:** Show cross-context meetings and personal meeting actions.
- **Foundation/Project:** Show context-scoped meetings.
- **Create/manage:** Requires the organizer-granting relation for the target — Project/Foundation Writer, Project Meeting Coordinator (meetings only), or Committee Writer when the target is a committee/group — per `PERMISSIONS.md`'s Scheduled Meeting inheritance (`Organizer` inherits from Project Meeting Coordinator, Committee Writer, Project Writer).
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
- **Create/manage:** Requires target context plus writer permission, OR `committee.writer` when the target is a committee/group.
- **Read-only:** User can vote or view results when eligible, but cannot create, edit, close, or delete votes.

### Surveys

- **Me:** Show surveys the user has been invited to or can view across contexts.
- **Foundation/Project:** Show context-scoped surveys.
- **Create/manage:** Requires target context plus writer permission, OR `committee.writer` when the target is a committee/group.
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
- **Denied actions:** Do not add Foundation/Project selector access unless an auditor or explicit role grant exists.

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
- **Denied actions:** Do not add Foundation/Project selector access unless a separate auditor/explicit role grant exists.

### Discover Projects Or Foundations

- **Input:** User finds a project/foundation outside active membership.
- **Required permission:** Public profile or discovery eligibility.
- **Destination:** Public profile, follow/join/request access flow.
- **Allowed actions:** Follow, join, request access, view public profile.
- **Denied actions:** Do not expose private context pages until an auditor or explicit role grant exists.

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

### User Has No Grant-Permitted Foundations

- **Input:** User clicks Foundation context.
- **Destination:** Stay in Me or Discovery.
- **Allowed actions:** Show discovery/request paths.
- **Denied actions:** Do not enter an empty Foundation shell.

### User Has A Discoverable But No-Grant Foundation

- **Input:** User can discover a foundation but holds no authoritative role or auditor/explicit role grant.
- **Destination:** Browse/Discovery only.
- **Allowed actions:** View public profile or request access if available.
- **Denied actions:** Do not include it in selector and never default to it.

### User Has No Grant-Permitted Projects

- **Input:** User clicks Project context.
- **Destination:** Stay in Me or Discovery.
- **Allowed actions:** Show discovery/request paths.
- **Denied actions:** Do not enter an empty Project shell.

### User Has A Discoverable But No-Grant Project

- **Input:** User can discover a project but holds no authoritative role or auditor/explicit role grant.
- **Destination:** Browse/Discovery only.
- **Allowed actions:** View public profile, follow, join, or request access if available.
- **Denied actions:** Do not include it in selector and never default to it.

### User Loses Auditor/Explicit Role Grant Mid-Session

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
- **No-grant default:** user defaults into a context without an authoritative role or auditor/explicit role grant. Target: zero.
- **Selector no-grant item:** selector shows a context without an authoritative role or auditor/explicit role grant. Target: zero.
- **UI-allowed/API-denied write:** UI showed or enabled a write action that the API denied for permission. Target: zero after rollout.
- **Multiple role labels per context:** one context shows conflicting roles in selector, page header, or resource rows. Target: zero.
