# Specification Quality Checklist: Marketing Ops UI Access

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-15
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- The per-surface permission model was clarified by the user (2026-07-15) and encoded in the spec's Clarifications + "Surface → grant → audience" table:
  - Marketing nav + Marketing Impact → `marketing_auditor` (ED + Marketing Ops + Marketing Auditor, read-only).
  - Campaigns page → `campaign_manager` = ED + Marketing Ops (full view + actions, no view-only tier); Marketing Auditors excluded.
  - Dashboard Marketing Overview section → ED + Marketing Ops (read-only); Marketing Auditors excluded.
  - Health Metrics + rest of ED dashboard → unchanged (ED-only).
- Scope decisions confirmed: (1) all three marketing roles can browse/search/select projects to reach marketing surfaces (in scope); (2) authoritative server-side (BFF) enforcement of marketing APIs is out of scope (owned by LFXV2-2235).
- Relation naming in the current authorization model (`marketing_auditor`, `campaign_manager`) supersedes earlier ticket wording (`marketing_dashboard_viewer`, `campaign_viewer`).
- **Deferred to planning**: the presentation mechanism for surfacing the Marketing Overview section to non-ED Marketing Ops users (the section lives inside the ED-only dashboard today). The visibility rule itself is fully specified.
