<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Organization Lens EasyCLA — role-bridge (who sees Sign, who can change the approval list)

Internal support note. Not Help Center copy.

## Who can open `/org/easycla`

Anyone with an Organization Lens **Writer**, **Viewer** (auditor), or **Staff** grant on that organization. This is the page see-gate. It did not change.

An organization admin who is not a CLA manager can still **read** the page.

## Who sees Sign CLA

ACS, not Org Lens Writer.

- List toolbar: the viewer holds a `self_serve_request_corporate_signature` / `create` grant whose scope covers this company.
- Picker Continue, unsigned Start, and attestation Continue: ACS allows `self_serve_request_corporate_signature:create:project|organization:{projectOrFoundationSfid}|{companySfid}` for the chosen pair.

If that check fails, times out, or is still in flight, Sign is withheld (fail closed). EasyCLA v4 still 403s an unauthorized write; this hop only hides the control.

## Who can add, edit, or remove approval-list entries

ACS `signature_approval_list:update:project|organization:{projectOrFoundationSfid}|{companySfid}`.

The agreement's roster `canEdit` flag does **not** drive those buttons. It may still appear on the payload for leftover non-mutation display and as a server-side defence-in-depth on the PUT. ACS can lag the signature ACL by about thirty minutes — that dual truth is accepted.

## Grain

CLA authority is per **project|organization pair**, not org-wide. A signatory for company A / project X cannot Sign for project Y from the same list.

## Impersonation

Writes stay blocked while impersonating. The permission check itself is a read, so the UI can still ask and withhold.

## What to tell a viewer who can see EasyCLA but not Sign

They have Org Lens access (so they can read) and no ACS signing grant for this company (or for this pair). Ask whether they are a CLA signatory or CLA manager designee for that project. A grant made in the last half hour may not have reached ACS yet.
