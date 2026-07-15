# Feature Specification: Marketing Ops UI Access (FGA-guarded Marketing pages)

**Feature Branch**: `feat/LFXV2-2236-add-marketing-ops-ui-access`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Review LFXV2-2236 — Add Marketing Ops UI access. OpenFGA relations were added to the platform model (`marketing_ops`, `marketing_auditor`, `campaign_manager`). Guard and provide access to the Marketing → Marketing Impact and Campaigns pages to authorized users on a per-project basis. The Marketing Ops role should have access to all Marketing pages; project EDs should have access to their own project's Marketing pages. Review the current front-end permissions setup, then produce an execution plan."

## Context & Problem Statement

Today, the **Marketing Impact** and **Campaigns** pages (reached from the "Projects" view sidebar, under the **Marketing** section), and the **Marketing Overview** section of the dashboard, are shown and route-guarded **solely by the Executive Director (ED) persona**. Visibility is decided by a persona flag, not by a per-project authorization check.

Two problems follow:

1. **Marketing Ops and Marketing Auditor staff cannot access these surfaces.** People who run or audit marketing operations are frequently not EDs, so persona-only gating locks them out even though the platform authorization model now grants them access.
2. **Access is not truly per-project.** Persona gating is a global on/off; it does not reflect which specific projects a user is authorized to view marketing data for.

The platform authorization model (OpenFGA) has been updated with per-project relations that express marketing access precisely. This feature makes the Self-Serve UI honor those relations instead of the ED persona flag, while keeping **Health Metrics** and the **rest of the ED dashboard** ED-only.

## Authorization model (source of truth)

The following per-project relations exist in the platform authorization model and are the source of truth for this feature:

- **`marketing_auditor`** — read access to a project's marketing dashboards and campaigns navigation. Granted to the Marketing Ops team, to Executive Directors, and to explicitly-assigned Marketing Auditors; it **cascades down the project hierarchy from a parent** (a grant at ROOT flows to every sub-project).
- **`campaign_manager`** — management (full view **and** actions: create / edit / optimize) access to a project's campaigns. Defined in the model as **`executive_director or marketing_ops`** — i.e., it resolves to exactly EDs and Marketing Ops; there is no independent campaign-manager assignment and Marketing Auditors are **not** included.
- **`marketing_ops`** — the role/team relation that seeds the two above; assigned to the Marketing Ops team (manually / at ROOT for now) and cascades down the hierarchy.

### Surface → grant → audience mapping

| Surface | Governing grant | Who can see it | Access level |
|---------|-----------------|----------------|--------------|
| Project browse / search / select (to reach marketing surfaces) | any marketing grant (`marketing_ops`, `marketing_auditor`, or `campaign_manager`) | ED, Marketing Ops, Marketing Auditor | Navigate to any project they hold a marketing grant for |
| Marketing **navigation section** (sidebar) | `marketing_auditor` | ED, Marketing Ops, Marketing Auditor | View entries |
| **Marketing Impact** page | `marketing_auditor` | ED, Marketing Ops, Marketing Auditor | Read-only |
| **Campaigns** page | `campaign_manager` (= ED or Marketing Ops) | ED, Marketing Ops | Full view **and** actions |
| Dashboard **Marketing Overview** section | ED or Marketing Ops (equivalently, the `campaign_manager` grant) | ED, Marketing Ops | Read-only (no actions) |
| **Health Metrics** page | ED persona (unchanged) | ED | Unchanged |
| Rest of ED dashboard | ED persona (unchanged) | ED | Unchanged |

Effective outcomes:

- A **Marketing Ops team member** assigned at ROOT can browse to any project in the hierarchy and view Marketing Impact, use Campaigns (full actions), and view the Marketing Overview section — everywhere the grants resolve.
- A **Marketing Auditor** can browse to authorized projects and view the Marketing navigation and Marketing Impact page (read-only), but has **no** access to Campaigns and **no** access to the Marketing Overview section.
- A **project ED** retains view + campaign actions for their project (now decided by the authorization check rather than persona).
- A user with broad project access (e.g., project owner/writer) but **no** marketing relation must **not** see or reach any marketing surface — this is by design.

## Clarifications

### Session 2026-07-15

- Q: For marketing users who are not EDs/board members, how do they reach the marketing surfaces (they currently cannot see the "Projects" view or its project selector)? → A: In scope — Marketing Ops, Campaign Managers, and Marketing Auditors can view/search/access all projects (so they can find and open each project's marketing surfaces); per-project grants then govern what they see.
- Q: Should this ticket add server-side (BFF) authorization enforcement on the marketing data APIs, or limit enforcement to the UI probe (backend enforcement owned by the access-probe dependency)? → A: UI-only in this ticket — the UI probes access before calling marketing APIs; authoritative server-side enforcement is owned by the BFF access-probe dependency (LFXV2-2235) / backend.
- Q: Which roles see the dashboard Marketing Overview section, and is it read-only? → A: EDs and Marketing Ops only, read-only (no actions). No one else — Marketing Auditors excluded.
- Q: Who sees the Marketing navigation section and the Marketing Impact page? → A: EDs, Marketing Ops, and Marketing Auditors (read-only). No one else.
- Q: Who can access the Campaigns page and its actions, and is there a view-only tier? → A: EDs and Marketing Ops only (the `campaign_manager` grant), with full view and actions — no separate view-only tier. Marketing Auditors have no Campaigns access.
- Q: Are there any other product page permission changes in this feature? → A: No — only the marketing surfaces above change; all other product page permissions are unchanged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a project and view its marketing dashboards (Priority: P1)

An ED, a Marketing Ops team member, or a Marketing Auditor signs in, browses/searches the list of projects, selects one they are authorized for, and opens the **Marketing** navigation and the **Marketing Impact** page. They can read the marketing dashboards for every project where the model grants them `marketing_auditor` (including sub-projects that inherit the grant from ROOT). For projects where they have no marketing grant, the Marketing section and page are unavailable.

**Why this priority**: This is the core value of the ticket — unlocking read access to marketing dashboards for the people who operate and audit marketing, which is impossible today under persona-only gating.

**Independent Test**: With a test user holding `marketing_auditor` (but not ED), verify they can browse projects, the Marketing section appears, the Marketing Impact page loads for granted projects, and both are absent/blocked for a project with no grant.

**Acceptance Scenarios**:

1. **Given** a Marketing Auditor authorized for Project A, **When** they browse projects and select Project A, **Then** the Marketing section is visible and the Marketing Impact page loads (read-only).
2. **Given** a Marketing Ops user granted at ROOT, **When** they select any sub-project, **Then** the Marketing section and Marketing Impact page are available for that sub-project.
3. **Given** any marketing role with no grant on Project Z, **When** they select Project Z, **Then** the Marketing section is hidden and direct navigation to the Marketing Impact page is blocked.
4. **Given** a Marketing Auditor, **When** they open the Marketing Impact page, **Then** no actions are offered (read-only).

---

### User Story 2 - Manage campaigns for authorized projects (Priority: P1)

An ED or Marketing Ops team member opens the **Campaigns** page for a project they are authorized for and has full access to campaign views and actions (create / edit / optimize). A Marketing Auditor never sees or reaches the Campaigns page.

**Why this priority**: Campaign management is a primary operational task for Marketing Ops and EDs; the model deliberately restricts it to those roles, so gating it correctly is as critical as read access.

**Independent Test**: With an ED, a Marketing Ops user, and a Marketing Auditor on the same project, verify the first two see the Campaigns link/page with full actions and the auditor sees neither the link nor the page (blocked on direct navigation).

**Acceptance Scenarios**:

1. **Given** a Marketing Ops user with the campaign management grant on Project A, **When** they open Campaigns for Project A, **Then** the page loads with full view and action affordances.
2. **Given** a Marketing Auditor on Project A, **When** they view navigation, **Then** the Campaigns link is absent and direct navigation to the Campaigns page is blocked.
3. **Given** an ED of Project A, **When** they open Campaigns for Project A, **Then** they retain full view and actions (no regression).

---

### User Story 3 - View the dashboard Marketing Overview section (Priority: P2)

An ED or Marketing Ops team member views the dashboard for an authorized project and sees the **Marketing Overview** section (read-only). Marketing Auditors and all other users do not see this section.

**Why this priority**: Extends an at-a-glance marketing summary to Marketing Ops, but the standalone Marketing pages (P1) deliver the primary value, so this section is P2.

**Independent Test**: With an ED, a Marketing Ops user, a Marketing Auditor, and a non-marketing user, verify only the ED and Marketing Ops see the Marketing Overview section, and it exposes no actions.

**Acceptance Scenarios**:

1. **Given** a Marketing Ops user for Project A, **When** they view the Project A dashboard, **Then** the Marketing Overview section is visible and read-only.
2. **Given** a Marketing Auditor for Project A, **When** they view the dashboard, **Then** the Marketing Overview section is not shown.
3. **Given** a non-marketing user, **When** they view the dashboard, **Then** the Marketing Overview section is not shown.

---

### Edge Cases

- **Broad project role, no marketing grant**: A project owner/writer without any marketing relation must see no marketing nav, no Marketing Overview section, be blocked from marketing routes, and have marketing surfaces hidden — even though they can manage other project areas.
- **Marketing Auditor at Campaigns**: An auditor with `marketing_auditor` but not `campaign_manager` must never see or reach Campaigns, even via direct URL.
- **Health Metrics & rest of ED dashboard**: Remain ED-only; this feature must not widen their audience (only the Marketing Overview section's audience changes).
- **Project without a marketing section**: When a user is authorized for a project that has no marketing data/section available, the marketing surface reflects an unavailable/empty state rather than erroring; navigation should not lead a permitted user to a broken page.
- **Context switch**: When the selected project changes, all marketing visibility (nav, pages, overview section) and access are re-evaluated for the newly selected project.
- **Authorization probe unavailable/errors**: The UI fails closed — marketing surfaces are hidden and pages blocked rather than shown optimistically.
- **Direct URL / deep link**: Navigating directly to a marketing page without the required grant is blocked (redirected away), not merely visually hidden.
- **Data fetched before authorization known**: Marketing data requests are not issued until the relevant access check has passed for the selected project.
- **Mixed grants across a hierarchy**: A user granted at one branch but not another sees marketing only where granted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST decide the visibility and access of all marketing surfaces using per-project authorization checks, replacing the current ED-persona-only gating.
- **FR-002**: The system MUST allow users holding any marketing grant (`marketing_ops`, `marketing_auditor`, or `campaign_manager`) to browse, search, and select projects in order to reach each project's marketing surfaces.
- **FR-003**: The system MUST show the Marketing navigation section and the Marketing Impact page to users with the marketing viewing grant (`marketing_auditor`) for the selected project — i.e., EDs, Marketing Ops, and Marketing Auditors — and hide them from everyone else.
- **FR-004**: The Marketing Impact page MUST be read-only (no actions) for all permitted roles.
- **FR-005**: The system MUST show and permit the Campaigns page (full view and actions) only to users with the campaign management grant (`campaign_manager`, i.e., EDs and Marketing Ops) for the selected project, and MUST deny Campaigns access (link hidden and route blocked) to Marketing Auditors and everyone else.
- **FR-006**: The Campaigns page MUST NOT expose a separate view-only tier — users who can see it get full view and actions; users who cannot are fully denied.
- **FR-007**: The system MUST show the dashboard Marketing Overview section (read-only, no actions) only to EDs and Marketing Ops for the selected project, and hide it from Marketing Auditors and all other users.
- **FR-008**: The system MUST block access (including direct navigation / deep links) to any marketing surface when the current user lacks the governing grant for the selected project, redirecting them to an allowed location.
- **FR-009**: The system MUST re-evaluate all marketing visibility and access whenever the selected project context changes.
- **FR-010**: The system MUST honor hierarchy cascade for the viewing grant — a Marketing Ops / auditor grant at a parent (e.g., ROOT) confers the corresponding access to sub-projects.
- **FR-011**: The system MUST NOT request marketing data (dashboard or campaign APIs) for a project until the corresponding access check for that project has passed.
- **FR-012**: The system MUST keep Health Metrics ED-only in both navigation and route access.
- **FR-013**: The system MUST keep the rest of the ED dashboard (all sections other than the Marketing Overview section) ED-only, with no change to their audience.
- **FR-014**: The system MUST hide all marketing surfaces from users who have broad project access (e.g., owner/writer) but lack the relevant marketing grant.
- **FR-015**: The system MUST fail closed when an authorization check cannot be completed (treat as no access).
- **FR-016**: Executive Directors MUST retain the marketing access they have today for their own projects (Marketing nav, Marketing Impact, Campaigns with actions, and the Marketing Overview section), now decided by the authorization check, with no regression.
- **FR-017**: The system MUST NOT change any product page permissions other than the marketing surfaces defined in this specification.

### Key Entities *(include if feature involves data)*

- **Marketing viewing grant (`marketing_auditor`)**: Per-project read permission that governs the Marketing navigation section and the Marketing Impact page; held by EDs, Marketing Ops, and Marketing Auditors; cascades from parent projects.
- **Campaign management grant (`campaign_manager`)**: Per-project permission that governs the Campaigns page (full view + actions) and the dashboard Marketing Overview section; resolves to EDs and Marketing Ops (no independent assignment); excludes Marketing Auditors.
- **Marketing Ops role (`marketing_ops`)**: Team membership that seeds the grants above; assigned (currently manually) at ROOT and cascades down the hierarchy.
- **Selected project context**: The project the user is currently viewing, which scopes every marketing access check and data request.
- **Marketing surfaces**: The Marketing navigation section, the Marketing Impact page (analytics dashboards), the Campaigns page (planning, implementation, monitoring, optimization), and the dashboard Marketing Overview section.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Only EDs, Marketing Ops, and Marketing Auditors can view the Marketing navigation section and the Marketing Impact page for a given project; no other role can — verified across at least one granted and one non-granted project.
- **SC-002**: Only EDs and Marketing Ops can view and act on the Campaigns page; Marketing Auditors and all other roles cannot see the link or reach the page — verified with an auditor and a non-marketing user.
- **SC-003**: Only EDs and Marketing Ops can view the dashboard Marketing Overview section (read-only); Marketing Auditors and all others cannot see it.
- **SC-004**: 100% of marketing page views and marketing data requests occur only after a passing per-project access check (no data request precedes an access decision).
- **SC-005**: Health Metrics and the rest of the ED dashboard remain visible only to Executive Directors — no non-ED user (including Marketing Ops and Marketing Auditors) can view them.
- **SC-006**: Users with broad project access but no marketing grant see zero marketing surfaces (nav, pages, overview section) and are blocked from all marketing routes.
- **SC-007**: Executive Directors experience no loss of marketing access for their own projects after the switch to authorization-based gating (zero regressions in test).
- **SC-008**: Marketing Ops, Campaign Managers, and Marketing Auditors can browse/search and select any project they hold a marketing grant for, in order to reach its marketing surfaces.
- **SC-009**: When the selected project changes, all marketing visibility updates to reflect the new project's grants without requiring a full reload.

## Assumptions

- **Relation naming & resolution**: The authoritative relations are `marketing_auditor` (governs Marketing nav + Marketing Impact) and `campaign_manager` (governs Campaigns + Marketing Overview section, resolving to EDs and Marketing Ops) as defined in the current platform authorization model. Earlier ticket wording referencing `marketing_dashboard_viewer` / `campaign_viewer` is treated as superseded by the model on disk.
- **Marketing Overview section presentation**: The Marketing Overview section currently lives inside the ED-only dashboard. Making it visible to non-ED Marketing Ops users requires surfacing that section for them; the exact presentation mechanism (e.g., a gated section within a shared dashboard vs. a tailored view) is a planning decision. The binding requirement is the visibility rule (ED + Marketing Ops, read-only, no one else).
- **Page scope & location**: This feature guards the **existing** Marketing surfaces (reached via the "Projects" view). It does not add new per-project marketing routes or relocate the pages; it changes only how visibility/access is decided and who can navigate to them. The pages continue to scope their data to the currently selected project/foundation context.
- **Access-check dependency**: A backend/BFF access-probe capability is available (or will be, via LFXV2-2235) for the UI to query per-project marketing relations. This feature consumes that probe; it does not define the probe's transport.
- **Server-side enforcement**: Authoritative enforcement of the marketing data APIs is owned by the BFF access-probe dependency / backend and is **out of scope** for this frontend ticket, which is responsible for probing before calling and hiding/blocking surfaces on failure. (Noted risk: until backend enforcement lands, the marketing data APIs remain reachable by direct call outside the UI.)
- **Team assignment**: Assigning the Marketing Ops team to ROOT (or any project) is done manually / via tuple insertion and is **out of scope** here (deferred to LFXV2-1760). This feature assumes such tuples exist for validation.
- **Health Metrics / rest of ED dashboard**: These stay governed by the existing ED persona mechanism; no change to their gating.

## Out of Scope

- Platform-admin UI to assign the Marketing Ops team at ROOT (manual tuple insertion; deferred to LFXV2-1760).
- The `marketing_ops_team` project-service attribute approach (cancelled).
- Authoritative server-side authorization of the marketing data APIs (owned by the BFF access-probe dependency / backend, LFXV2-2235).
- Any change to Health Metrics or to ED dashboard sections other than the Marketing Overview section.
- Any change to product page permissions outside the marketing surfaces defined here.

## Dependencies

- **LFXV2-2235** — BFF access probe / rule sets that the UI queries for per-project marketing relations.
- Presence of Marketing Ops team tuples (e.g., at ROOT) for end-to-end validation.
