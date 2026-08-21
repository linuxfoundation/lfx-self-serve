# Research: Contact CLA Manager consume

**Feature**: [spec.md](./spec.md) | **Date**: 2026-08-20

## Decision 1 — One dialog, three copy modes, two writes

v17 `openMgrModal(groupId, project, action)` with `mgrCopy.approval|removal|contact`. #1372 and #1574 both name “the shared Contact-CLA-Manager modal”. Two components would duplicate the manager list, checkbox contract, and zero-manager state.

**Rejected:** separate approval and removal dialogs; a Console deep link (removed from #1372 on 2026-08-14).

## Decision 2 — Consume #5151 paths; identity query same as PDF

Swagger (`cla.v2.yaml` on `origin/dev`):

- `GET /my-clas/{signatureID}/cla-managers` — 404 unknown / not-owned / ICLA
- `POST /my-clas/{signatureID}/cla-manager-requests` — body `my-cla-manager-request`

Both take the my-clas identity query parameters. BFF reuses `identityQuery` + impersonation `bearerToken` override on GET (read). POST uses default gateway token and is route-blocked during impersonation (write), matching prepare-sign.

**Rejected:** calling company/project `cla-managers` admin APIs; ACS role checks (#1574: signature ACL only).

## Decision 3 — Contact is GET + no-op Send

`emails/contact_cla_manager_templates.go` always says the contributor requested a CCLA action and asks the manager to update the Approved List. `requestType` enum is `removal | approval` only. Posting either for Contact would lie.

GET still runs so “the CLA manager(s) below” is true.

**Rejected:** POST `approval` as a stand-in; adding a producer `contact` type in this pass (EasyCLA out of scope).

## Decision 4 — Visibility gates

| Item                | Gate                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| Request approval    | ECLA + `statusReason === "not_on_approval_list"`                                    |
| Request Removal     | ECLA + `status !== "revoked"`                                                       |
| Contact CLA Manager | ECLA + `status === "needs_attention"` (v17; Valid ECLA has Removal but not Contact) |

Predicates live in `packages/shared` so they are unit-tested without TestBed. Factory maps them to `MenuItem[]`.

## Decision 5 — Empty recipients vs zero managers

Producer: empty `recipients` allowed only when zero managers resolve (record without email). UI: Send disabled when none checked; zero-manager state has no Send and no auto-POST. BFF always requires a non-empty `recipients` array on POST — this pass never sends the empty-record path.

## Decision 6 — Integration seam is a factory, not a profile-clas edit

Agent A owns uncommitted profile-clas work. Spreading `...buildContactClaManagerMenuItems(agreement, this.dialogService)` is the only hook. Factory opens `DialogService` itself so Agent A does not add an `openModal` method.

LaunchDarkly `my-clas-m2-enabled` is the caller’s gate. Factory does not import the flag SDK.

## Decision 7 — Modal stack

Sibling of `GithubAccountSelectComponent`: `DynamicDialogConfig` data, `ChangeDetectionStrategy.OnPush`, shared `lfx-button` / `lfx-textarea` / `lfx-checkbox`. Header set at `dialog.open` from mode copy. Manager fetch inside the dialog so the parent stays untouched.
