<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Organization Lens EasyCLA — role-bridge (who sees Sign, who can change the approval list)

Internal support note. Not Help Center copy.

## Who can open `/org/easycla`

Anyone with an Organization Lens **Writer**, **Viewer** (auditor), or **Staff** grant on that organization. This is the page see-gate. It did not change.

An organization admin who is not a CLA manager can still **read** the page.

## Who sees Sign CLA

Anyone who can see the page. Sign is not hidden from a company-level ACS inventory. Loading or a failed permission check must not hide the toolbar button.

Picker Continue and Start are navigation. They do not ask ACS.

Attestation Continue (Review and Sign) asks ACS whether this viewer may `self_serve_request_corporate_signature:create` for that **project|organization** pair. Deny or hop failure → a forbidden toast, stay on attestation, no signing session.

Toast copy is the Corporate Console forbidden page: summary `Forbidden`, detail `You Don't have access to this.`

EasyCLA v4 still 403s an unauthorized write. Attestation Continue deny must not walk the viewer to that 403.

## Who can add, edit, or remove approval-list entries

ACS `signature_approval_list:update:project|organization:{projectOrFoundationSfid}|{companySfid}`.

The agreement's roster `canEdit` flag does **not** drive those buttons. It may still appear on the payload for leftover non-mutation display and as a server-side defence-in-depth on the PUT. ACS can lag the signature ACL by about thirty minutes — that dual truth is accepted.

## Grain

CLA authority is per **project|organization pair**, not org-wide. A signatory for company A / project X cannot attestation-Continue for project Y.

## Impersonation

Writes stay blocked while impersonating. The permission check itself is a read, so the UI can still ask and refuse attestation Continue.

## What to tell a viewer who can see EasyCLA but cannot Review and Sign

They have Org Lens access (so they can read and see Sign) and no ACS signing grant for that project and organization. Ask whether they are a CLA signatory or CLA manager designee for that project. A grant made in the last half hour may not have reached ACS yet.
