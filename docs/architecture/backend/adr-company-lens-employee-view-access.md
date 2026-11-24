<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# ADR: All employee view access is decided in the BFF, outside OpenFGA

**Status:** Proposed, awaiting architect sign-off. **Epic:** linuxfoundation/lfx-self-serve#5845. **Behind a flag:** `LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED` (off).

## Context

Every other Company Lens read is authorized by a relation the authorizer (OpenFGA, through Heimdall and `b2b_org#auditor`) or the grant roster already holds. The all employee view (a reduced, read-only mode for ordinary employees of LF member companies) has no such relation: whether a person is an employee of a member company is not recorded as a grant.

## Decision

For this release the BFF derives the entitlement at request time, as a third qualification (`employee-view`) tried last in `assertOrgLensRead`, only for a caller with no grants who is not staff. It requires both a validated email on the registered domain of an active Linux Foundation member company and that company as a present employer in the caller's own profile work history; when several qualify, the most recent start date wins. Nothing is stored. The company is found from the active Linux Foundation memberships (`project_membership`, active memberships of any foundation), read with the BFF machine token, because the caller has just been refused `b2b_org#auditor`, which the query service applies per row and which would hide every company from their own token. Memberships need no `b2b_org` grant: the newsletter member benefit already reads them with the same token. The read holds no personal data (company id, name, one registered domain, status), is cached per process for 10 minutes, and is matched only against the caller's own verified domains. It reads the membership index rather than a per-row-authorized resource by design, and is part of the decision awaiting sign-off here. The mode is read-only (on the lens prefix; see the Company Lens employee view doc) and default-deny: only paths on `ORG_LENS_EMPLOYEE_VIEW_ALLOWED_PATHS` are reachable, and each page applies the redaction tools.

## Why not a relation now

- A tuple needs a writer: something must create and revoke `b2b_org:<uid>#employee` when a validated email or work-history entry changes. Neither source emits an event today, so a writer would be a poller or a sync job.
- The inputs are self-asserted (work history) or non-expiring (verified email); a stored tuple would make a soft signal look like a hard grant and outlive it.
- The view exposes no personal data, which bounds the cost of the soft signal while the proof is derived.

## Consequences

- The selector shows an employee company without an explicit grant, which departs from `permission-persona-navigation-model-preread.md`.
- The rule lives in application code (`OrgEmployeeViewService`), so every reader of the gate must go through it; default-deny paths and a flag limit the blast radius.
- Former employees keep access until they end the work-history entry (accepted for this release).
- **Interim lookup, decided by the product owner: website-host proof now, a member-service lookup in a later pull request.** The company is found from the active memberships of any foundation (`project_membership`), which needs no `b2b_org` grant (that resource is gated on `auditor`, which the BFF machine client does not hold; see `docs/architecture/frontend/lens-system.md`, "`b2b_org` access"). A membership's `company_domain` is filled from the company's website (`org.Website`), not its registered email domains, so the proof is website-host proof, and a membership carries no slug. Known limits, all failing safe (never admitting): a company with no website (about 1% of active member companies in the warehouse scan) is not matched; a company whose email domain differs from its website host, or that is reached only through an alias domain, is not matched; and a slug address does not open for an employee-view user (the id address does). In the same scan the registered alias lists were polluted (for example one company carried another's whole list), so the website host is the cleaner of the two for several companies. The permanent lookup, reading the registered domains and slug through an internal `lfx-v2-member-service` lookup, is a later pull request; this interim path is then replaced.
- _(Superseded)_ Earlier prerequisite: the BFF machine client must be able to read `b2b_org`. `b2b_org` is gated on `auditor`, and today the app's M2M client cannot read it (see `docs/architecture/frontend/lens-system.md`, "`b2b_org` access"). Until it holds `b2b_org#auditor` (an OpenFGA grant owned by the platform team), the company lookup returns no rows and every qualifying employee is denied (`no-verified-company-email`). This fails safe, never open, and the zero-row warning log makes it visible. Decision: grant the M2M client that read, scoped to this one lookup, rather than add a member-service lookup. A NATS lookup in `lfx-v2-member-service` stays the alternative if the grant is refused.

## Follow-up

When email validation has a freshness concept and the profile has a primary employer, move to a relation-based check: a tuple (or Heimdall RuleSet) written from those events, following the LFXV2-2936/2937 precedent. Architects decide whether to approve the interim BFF-derived rule or require the relation first.
