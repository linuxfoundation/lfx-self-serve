<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# ADR: All employee view access is decided in the BFF, outside OpenFGA

**Status:** Proposed, awaiting architect sign-off. **Epic:** linuxfoundation/lfx-self-serve#5845. **Behind a flag:** `LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED` (off).

## Context

Every other Company Lens read is authorized by a relation the authorizer (OpenFGA, through Heimdall and `b2b_org#auditor`) or the grant roster already holds. The all employee view (a reduced, read-only mode for ordinary employees of LF member companies) has no such relation: whether a person is an employee of a member company is not recorded as a grant.

## Decision

For this release the BFF derives the entitlement at request time, as a third qualification (`employee-view`) tried last in `assertOrgLensRead`, only for a caller with no grants who is not staff. It requires both a validated email on one of an active member company's registered domains and that company as a present employer in the caller's own profile work history; when several qualify, the most recent start date wins. Nothing is stored. The company is found by reading `b2b_org` records with the BFF machine token, because the caller has just been refused `b2b_org#auditor`, which the query service applies per row and which would hide every company from their own token. The machine-token read is scoped to this one lookup, runs only for the caller's own verified addresses, returns only id, name, slug and domains, and re-checks every returned record's domains. It bypasses the per-row auditor check by design and is part of the decision awaiting sign-off here. The mode is read-only (on the lens prefix; see the Company Lens employee view doc) and default-deny: only paths on `ORG_LENS_EMPLOYEE_VIEW_ALLOWED_PATHS` are reachable, and each page applies the redaction tools.

## Why not a relation now

- A tuple needs a writer: something must create and revoke `b2b_org:<uid>#employee` when a validated email or work-history entry changes. Neither source emits an event today, so a writer would be a poller or a sync job.
- The inputs are self-asserted (work history) or non-expiring (verified email); a stored tuple would make a soft signal look like a hard grant and outlive it.
- The view exposes no personal data, which bounds the cost of the soft signal while the proof is derived.

## Consequences

- The selector shows an employee company without an explicit grant, which departs from `permission-persona-navigation-model-preread.md`.
- The rule lives in application code (`OrgEmployeeViewService`), so every reader of the gate must go through it; default-deny paths and a flag limit the blast radius.
- Former employees keep access until they end the work-history entry (accepted for this release).

## Follow-up

When email validation has a freshness concept and the profile has a primary employer, move to a relation-based check: a tuple (or Heimdall RuleSet) written from those events, following the LFXV2-2936/2937 precedent. Architects decide whether to approve the interim BFF-derived rule or require the relation first.
