# Contract: Contact CLA Manager UI

**Feature**: [../spec.md](../spec.md) | **Satisfies**: FR-001–FR-005, FR-008, FR-011–FR-013, FR-015 | **Date**: 2026-08-20

## Kebab factory

New file: `apps/lfx-one/src/app/modules/profile/clas/contact-cla-manager-menu.ts`

```ts
export function buildContactClaManagerMenuItems(
  agreement: MyClaAgreement,
  dialog: DialogService,
): MenuItem[]
```

Uses shared predicates (`canRequestClaApproval`, `canRequestClaRemoval`, `canContactClaManager`). Opens `ContactClaManagerComponent` via `dialog.open` with header + `data: { signatureId, projectName, mode }`.

Returns `[]` for ICLA and `revoked`. Safe to spread on every row.

**Does not** read LaunchDarkly. Caller invokes only when `my-clas-m2-enabled` is on.

**Does not** edit `profile-clas.component.ts`. Agent A adds:

```ts
...buildContactClaManagerMenuItems(agreement, this.dialogService),
```

Order (v17): Request approval (if gated) → Request Removal → Contact CLA Manager (if Needs attention).

## Modal

New files: `contact-cla-manager.component.{ts,html,spec.ts}`

| Mode | Title | Hint |
|---|---|---|
| approval | Request approval | Ask the CLA manager(s) below to re-approve your ECLA for {project}. |
| removal | Request Removal | Ask the CLA manager(s) below to remove your ECLA for {project}. This starts the process to invalidate it on your behalf. |
| contact | Contact CLA Manager | Send a message to the CLA manager(s) for {project}. |

On init: `MyClasService.getClaManagers(signatureId)`.

- Loading: spinner, no Send
- Error: failure copy, no Send
- Empty list: unreachable-manager copy + Linux Foundation support, Cancel only
- Managers: checkbox per row, checked by default, label `name || lfUsername`
- Message: optional textarea, placeholder “Add a note for the CLA manager…”
- Send disabled when no checkbox is on, or while submitting
- **approval / removal Send:** POST then close; toast on success (`sent` vs `recorded`); error stays open with a message
- **contact Send:** close immediately; **no HTTP POST**; no “message sent” toast

## 002 row-actions exception

`contracts/my-clas-row-actions.md` “Real actions only” would hide Contact because Send does not perform a producer write. **This feature records an exception:** Contact may render; it is a product-complete no-op. Implementing it as `POST requestType: approval|removal` is forbidden.

## Out of UI scope

Manage in CCLA Console. Wiring `my-clas-m2-enabled` inside profile-clas. Invalidated-row legal review beyond Request Removal visibility (FR-003).
