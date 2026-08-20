# Feature Specification: Contact CLA Manager (Request approval / Request Removal)

**Feature Branch**: `009-cla-manager-request`
**Created**: 2026-08-20
**Status**: Draft
**Input**: [lfx-self-serve#1372](https://github.com/linuxfoundation/lfx-self-serve/issues/1372) — "Request approval action on Needs-attention ECLA rows". Shared modal also satisfies [lfx-self-serve#1574](https://github.com/linuxfoundation/lfx-self-serve/issues/1574) Self Serve FE+BFF (Request Removal). Third kebab **Contact CLA Manager** has no new ticket (product, 2026-08-20). Upstream producer: [easycla#5151](https://github.com/linuxfoundation/easycla/pull/5151) merged to `dev` 2026-08-20. Design: v17 Final prototype `openMgrModal` three copy modes.

Delivery git branch is **`feat/GH-1372`**. Spec-kit directory name and git branch are independent. Do not edit `profile-clas.component.{ts,html,spec.ts}` in this pass — export a menu-item factory for Agent A to spread.

## Background *(why this exists)*

#1372 originally deep-linked into the Contributor Console request-approval flow. The 2026-08-14 legal/stakeholder review replaced that with an in-app **Contact CLA Manager** message modal (`openMgrModal(..., 'approval')`). #1574 is the same modal in `removal` mode. v17 also has a `contact` mode.

The producer already emails CLA managers for **Approved-List changes only**. `POST /v4/my-clas/{signatureID}/cla-manager-requests` accepts `requestType: "approval" | "removal"`. The email template tells the manager to update the Approved List. There is no `contact` type, and inventing one by posting `approval` or `removal` would claim a list change the contributor did not ask for.

This specification is the Self Serve consume: one modal, two live writes, one no-op Send, plus BFF routes that forward identity the same way PDF download does.

## Clarifications

### Session 2026-08-20

- Q: Shared modal vs two dialogs? → A: **One component**, three copy modes (`approval`, `removal`, `contact`). Two live API modes (`approval`, `removal`).
- Q: When is Request approval shown? → A: **ECLA and `statusReason === "not_on_approval_list"` only.** `needs_attention` alone is not enough.
- Q: When is Request Removal shown? → A: **ECLA rows that are not Revoked.** Never on ICLA. Follows #1574 AC + v17.
- Q: Contact CLA Manager — new ticket? API? → A: **No new ticket.** Same modal, v17 `contact` copy (“Send a message to the CLA manager(s)…”). **GET managers still runs** so the list matches the copy. **Send is a no-op — no POST.** Explicit exception to 002 `my-clas-row-actions.md` “real actions only”: Contact is a product-complete no-op, not a stub.
- Q: Empty recipient list? → A: **Send disabled when no manager is checked.** BFF rejects an empty `recipients` array. Zero resolved managers: explanatory support copy, no Send, no silent POST on open.
- Q: Impersonation? → A: **Block the POST** (`blockDuringImpersonation`, same as prepare-sign). GET stays a read.
- Q: Feature flag? → A: LaunchDarkly **`my-clas-m2-enabled`** (kebab family of `my-clas-enabled`; default off) gates Sign CLA, Status column, kebab/actions, Signed-as. This pass does **not** wire it into profile-clas. The exported factory is only *used* when that flag is on. Do not hide the modal behind a second flag name.
- Q: Who edits the kebab in profile-clas? → A: **Agent A.** This pass exports `buildContactClaManagerMenuItems`. One spread in `buildRowMenuItems`. Factory returns `[]` for ICLA and Revoked.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Request approval from a Needs-attention ECLA (Priority: P1)

A contributor whose employee acknowledgement no longer matches the company Approved List opens **Request approval**, sees the CLA manager(s) for that company and CLA group, optionally writes a message, and Send notifies the managers they checked. Self Serve does not change signature state.

**Why this priority**: This is #1372. Until it ships, Needs-attention rows have a status with no way to ask for re-approval in-app.

**Independent Test**: Open the modal on an ECLA with `statusReason === "not_on_approval_list"`, confirm managers load, Send posts `requestType: "approval"` with the checked LF usernames, success/error shown, no Console navigation.

**Acceptance Scenarios**:

1. **Given** an ECLA row with `statusReason` `not_on_approval_list`, **When** the contributor chooses Request approval, **Then** the shared modal opens in approval mode with v17 approval title and hint naming the project.
2. **Given** the modal is open, **When** managers resolve, **Then** each is a checkbox checked by default and the hint refers to “the CLA manager(s) below”.
3. **Given** at least one manager is checked, **When** they Send, **Then** the producer is asked to notify those managers as an approval request, including the optional message when provided, and the modal closes on success.
4. **Given** every manager is unchecked, **When** the Send control is inspected, **Then** it is disabled and no request is sent.
5. **Given** the producer succeeds, **When** the contributor looks at their CLA list, **Then** no signature has been invalidated or re-approved by Self Serve.

---

### User Story 2 - Request Removal from a non-Revoked ECLA (Priority: P1)

A contributor asks the CLA manager(s) to remove their ECLA. Copy makes clear this starts invalidation on their behalf; the manager finishes it in the corporate console. Same modal, removal mode.

**Why this priority**: Same component as US1; #1574 AC. SS never invalidates.

**Independent Test**: Open removal mode on a Valid ECLA (not Revoked, not ICLA), Send posts `requestType: "removal"` with checked recipients, no signature mutation.

**Acceptance Scenarios**:

1. **Given** a non-Revoked ECLA, **When** they choose Request Removal, **Then** the modal opens in removal mode with v17 removal title and the “starts the process to invalidate it on your behalf” hint.
2. **Given** they Send with at least one manager checked, **When** the request completes, **Then** selected managers are notified as a removal request and Self Serve has not invalidated the row.
3. **Given** an ICLA or a Revoked ECLA, **When** the ⋮ menu is built, **Then** Request Removal is not offered.

---

### User Story 3 - Contact CLA Manager does not claim an Approved-List change (Priority: P2)

On a Needs-attention ECLA, **Contact CLA Manager** opens the same modal with v17 contact copy. The contributor still sees who the managers are. Send does not notify them through the approval/removal API.

**Why this priority**: Product-complete no-op. Posting `approval` or `removal` would email a list-change claim.

**Independent Test**: Open contact mode, confirm GET for the list, Send closes the modal and the BFF is not asked to POST a manager request.

**Acceptance Scenarios**:

1. **Given** a Needs-attention ECLA, **When** they choose Contact CLA Manager, **Then** the modal opens with title “Contact CLA Manager” and hint “Send a message to the CLA manager(s) for {project}.”
2. **Given** that modal, **When** they Send, **Then** no `cla-manager-requests` call is made and the modal closes.
3. **Given** a Valid ECLA (not Needs attention), **When** the menu is built, **Then** Contact CLA Manager is not offered (v17).

---

### User Story 4 - Zero reachable CLA managers is explained, not a silent Send (Priority: P2)

When the covering CCLA has no reachable CLA manager, the modal says so and points at Linux Foundation support instead of offering a Send that goes nowhere.

**Why this priority**: #1574 zero-manager AC. The legacy allowlist flow logged a warning and bailed; that is forbidden here.

**Independent Test**: Stub GET with an empty manager list; assert support copy, no Send, no POST.

**Acceptance Scenarios**:

1. **Given** GET returns no managers, **When** the modal finishes loading, **Then** the contributor sees that no CLA manager is currently reachable for this company and is pointed at Linux Foundation support.
2. **Given** that state, **When** the actions are inspected, **Then** there is no Send control and no request is posted automatically.

---

### User Story 5 - Impersonation cannot email CLA managers (Priority: P2)

An administrator viewing someone’s CLAs can still see who the managers would be, but cannot Send an approval or removal request as that person.

**Why this priority**: Same write class as prepare-sign (externally visible email, attributed to the target).

**Independent Test**: POST the BFF request route while impersonating → 403 `IMPERSONATION_READ_ONLY`; GET managers still 200.

**Acceptance Scenarios**:

1. **Given** an impersonating session, **When** a removal or approval Send is attempted against the BFF, **Then** it is refused with the existing read-only impersonation code and the producer is not called.
2. **Given** the same session, **When** managers are listed, **Then** the list still loads (read).

---

### Edge Cases

- **ICLA.** No Request approval, no Request Removal, no Contact. Factory returns `[]`.
- **Revoked ECLA.** No items from this factory (row already has an empty actions cell).
- **Needs attention with `statusReason` other than `not_on_approval_list`.** Request approval hidden; Request Removal still shown; Contact still shown (Needs attention).
- **Invalidated or unknown ECLA.** Request Removal only (not Revoked, not ICLA).
- **Producer 404** (unknown, not-owned, ICLA id). Modal error state; no Send.
- **Producer `status: recorded`.** Audit wrote, no email (selected managers had no resolvable address). Surface as success-with-explanation, not as a hard failure.
- **`message` over 4096 characters.** Rejected before the producer (BFF 400).
- **Contact Send.** No toast that implies mail was delivered.
- **`my-clas-m2-enabled` off.** Factory is not called (caller’s job). Modal is not behind a second flag.
- **002 “real actions only”.** Contact is the documented exception (Clarifications). Do not hide the item; do not POST a lying `requestType`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Self Serve MUST present Request approval, Request Removal, and Contact CLA Manager through **one** shared message modal with three copy modes matching v17 (`approval`, `removal`, `contact`).
- **FR-002**: Request approval MUST be offered only for ECLA rows whose `statusReason` is `not_on_approval_list`.
- **FR-003**: Request Removal MUST be offered for ECLA rows whose status is not `revoked`, and MUST NOT be offered for ICLA or Revoked rows.
- **FR-004**: Contact CLA Manager MUST be offered for Needs-attention ECLA rows only, MUST use v17 contact copy, MUST load the manager list, and MUST NOT call `POST .../cla-manager-requests` (nor any other producer write) on Send.
- **FR-005**: The modal MUST list resolved CLA managers as checkboxes checked by default. Send MUST be disabled when none are checked. The BFF MUST reject an empty `recipients` list.
- **FR-006**: For approval and removal, Send MUST call the CLA backend `POST /v4/my-clas/{signatureID}/cla-manager-requests` with `requestType` `approval` or `removal`, the checked managers’ LF usernames, and the optional message. Self Serve MUST NOT invalidate or re-approve the signature.
- **FR-007**: Self Serve MUST load managers via `GET /v4/my-clas/{signatureID}/cla-managers`, forwarding the same session identity query used for My CLAs and PDF. Unknown / not-owned / ICLA ids are a not-found error, not an empty list.
- **FR-008**: When no managers resolve, the modal MUST show an explanatory unreachable-manager state pointing at Linux Foundation support, MUST NOT show Send, and MUST NOT auto-POST.
- **FR-009**: The manager-request POST MUST be blocked during impersonation. The managers GET MUST remain available.
- **FR-010**: Self Serve MUST NOT persist manager requests. One upstream GET per open, one upstream POST per approval/removal Send.
- **FR-011**: Menu items for this feature MUST be produced by an exported factory in a new file, safe to spread onto any row (empty for ICLA and Revoked). This feature MUST NOT edit `profile-clas.component.ts`, `.html`, or `.spec.ts`.
- **FR-012**: The factory MUST NOT read a feature-flag key. Callers MUST invoke it only when `my-clas-m2-enabled` is on. The modal component MUST NOT be hidden behind a second flag name.
- **FR-013**: Contact CLA Manager is an explicit exception to the 002 row-actions “real actions only” rule: it may render even though Send is a no-op. Posting `approval` or `removal` for contact is forbidden.
- **FR-014**: BFF `requestType` MUST accept only `approval` and `removal`. A `contact` body is 400.
- **FR-015**: Success and failure of approval/removal Send MUST be visible. Contact Send MUST NOT display a “message sent” success.

### Key Entities

- **CLA manager**: Display name, optional email, LF username (the recipient key).
- **Manager list**: Managers on the CCLA signature ACL covering the ECLA; may be empty.
- **Manager request**: `approval` or `removal`, selected LF usernames, optional message. Receipt `sent` or `recorded`.
- **Modal mode**: `approval` | `removal` | `contact` (copy). Only the first two are request types.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A contributor can open Request approval, pick recipients, and finish Send without leaving Self Serve and without a Console deep link.
- **SC-002**: A contributor can complete Request Removal on a non-Revoked ECLA the same way; the row is not invalidated by that Send.
- **SC-003**: Contact Send produces zero producer writes (verified by network / BFF tests).
- **SC-004**: Request approval is absent unless ECLA + `not_on_approval_list`; Request Removal is absent on ICLA and Revoked; Contact is absent off Needs-attention ECLA.
- **SC-005**: With two managers, unchecking both disables Send; checking one sends only that LF username.
- **SC-006**: Empty manager list shows support copy and no Send, on the first paint after load (no silent failure).
- **SC-007**: Impersonated POST is refused; impersonated GET still returns managers.
- **SC-008**: profile-clas source files are unchanged in this branch’s work for this feature; the factory is the integration seam.

## Assumptions

- Producer #5151 is deployed on DEV with ACS grants for both manager paths (same `user` role pattern as my-clas / prepare-sign).
- `status` and `statusReason` are already on the My CLAs row (Agent A / #1423 consume).
- Agent A (or the flag follow-up) spreads the factory only when `my-clas-m2-enabled` is on and does not require this pass to open the dialog from profile-clas.
- Linux Foundation support is named in copy; this pass does not add a new support-ticket integration.
- v17 item order (approval → removal → contact) overrides 002 “destructive last” for these three items.
