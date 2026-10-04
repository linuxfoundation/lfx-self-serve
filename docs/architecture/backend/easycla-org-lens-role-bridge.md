<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Organization Lens EasyCLA — role-bridge (who sees Sign, who can change the approval list, who can invalidate, who can change Auto ECLA)

Internal support note. Not Help Center copy.

## Who can open `/org/{organization}/easycla`

The organization-addressed form is the page's address for every in-app link (spec 050 phase 2, lfx-self-serve#2743). The corporate-signing `return_url` the BFF mints follows only once the `ORG_EASYCLA_RETURN_IN_PATH` rollout gate is on (`ServerFeatureFlag.OrgEasyclaReturnInPath`, shipped `false` — see the chart README, "EasyCLA Signing Return Address"); until then every new return is still minted on the leftover `/org/easycla/{group}?org={org}&signed=1` shape, which every release reads. The leftover mount and its `?org=` reader stay for one release after the gate flips, then go under #2743 item 4.

Anyone with an Organization Lens **Writer**, **Viewer** (auditor), or **Staff** grant on that organization. This is the page see-gate. It did not change.

An organization admin who is not a CLA manager can still **read** the page.

## Who sees Sign CLA

Anyone who can see the page. Sign is not hidden from a company-level ACS inventory. Loading or a failed permission check must not hide the toolbar button.

Picker Continue is navigation. It does not ask ACS.

The overview of an unsigned agreement runs that same Sign check once, on render, only to decide what Start asks first. A viewer who already holds the grant reads the designee steps and goes straight on. Anyone else is asked Corporate Console's "Are you authorized to be a CLA Manager?". Yes makes the viewer the initial CLA Manager designee (`POST /api/orgs/:orgUid/lens/cla-groups/designee`, address from the session). No names someone else (`POST /api/orgs/:orgUid/lens/cla-groups/designee/nominations`). Both writes sit on the page see-gate, are blocked during impersonation, and leave the grant decision to the CLA service and ACS. A pending or failed check never disables or refuses Start.

Attestation Continue (Review and Sign) asks ACS whether this viewer may `self_serve_request_corporate_signature:create` for that **project|organization** pair. Deny or hop failure → a toast, stay on attestation, no signing session.

Toast: summary `Can't start signing`, detail `You aren't designated to sign this corporate CLA for your organization.`

EasyCLA v4 still 403s an unauthorized write. Attestation Continue deny must not walk the viewer to that 403.

## Who can add, edit, or remove approval-list entries

ACS `signature_approval_list:update:project|organization:{projectOrFoundationSfid}|{companySfid}` **and** the viewer named on that CCLA's own manager roster. Both must hold for Add, Edit, and Remove to show.

The roster half is the list row's `viewerIsClaManager` flag. The server matches the session's LF username claim (`https://sso.linuxfoundation.org/claims/username`, or the impersonated user's username while impersonating) exactly against each CLA manager's LF username, with no case folding or trimming, the same comparison EasyCLA makes. There is no fallback to `nickname` or any other username. It exists because the PUT is refused on the roster as well as on ACS: an organization admin can hold the ACS grant without being a CLA manager on this CCLA, and a control shown on ACS alone walked that viewer into a 403. The flag fails closed — a row with no roster, or a session without the LF username claim, hides the controls. The controls also need the approval list's own `canEdit` to be true, so a list read after the row can still withdraw them. The PUT's own roster check (`canEdit`) stays as the enforcement and still lets a row with no roster through.

ACS can lag the signature ACL by about thirty minutes, so a manager added or removed recently can briefly see the controls disagree with ACS.

## Who can invalidate an acknowledgment

The per-row **Invalidate** control on the Contributor Acknowledgments tab asks ACS `ecla_invalidate:update:project|organization:{projectOrFoundationSfid}|{companySfid}` — the same project|organization pair grain (see Grain) as Sign and the approval list, but a **separate** permission from `signature_approval_list:update`. The confirmation dialog's optional "also remove the matching approval-list entries" step is gated on the approval-list permission, so a viewer can be allowed to invalidate without being allowed to remove entries, and vice versa.

The check **fails closed**. Invalidate is hidden until the check resolves, and stays hidden while it is pending or on a denied/errored result — a loading or failed permission check never shows the control. Like the approval list, Invalidate and the dialog's remove step also need the viewer on the CCLA's roster (`viewerIsClaManager`) and the acknowledgment list's own `canEdit`, which is false on a row with no roster; so does the Not Authorized row's "Add the user to the Approval list" remedy.

The BFF invalidate route (`org_cla_invalidate_acknowledgment`) enforces, in order: `blockDuringImpersonation` (declared before the access gate because the write stamps the acting user as `invalidatedBy`), `requireOrgLensAccess`, and the agreement's roster `canEdit` — the caller must be named on that CCLA's own manager roster, and a row with no roster is refused. EasyCLA's invalidate checks ACS scope only, never the roster, so this is the only roster check the write gets. The acknowledgment must also belong to this company's CLA Group. EasyCLA v4 owns the final write and 403s an unauthorized one; it 409s an invalidate of an acknowledgment that is not currently approved.

As with the approval list, the button needs both ACS `ecla_invalidate:update` and the roster, and the ~30-minute ACS-vs-ACL lag is accepted.

## Who can change Auto ECLA

The Overview's Auto ECLA toggle shows on a signed CCLA when ACS grants `auto-ecla-update` for the pair **and** the viewer is on that CCLA's roster (`viewerIsClaManager`). The BFF route refuses a caller off the roster with a 403 before calling EasyCLA (`Only a CLA manager named on this CLA can change its Auto ECLA setting`); EasyCLA itself refuses one too, and also 403s a sanctioned organization with its own sentence.

On a row with no CLA Manager list at all, the BFF cannot check the roster, so the Auto ECLA and approval-list writes are passed through to EasyCLA, which re-checks them. Invalidate is the exception and is refused, because EasyCLA does not check the roster on it.

## Grain

CLA authority is per **project|organization pair**, not org-wide. A signatory for company A / project X cannot attestation-Continue for project Y.

The ACS pair is the first covered project SFID, falling back to the foundation SFID when no listed project has a usable SFID (the same id `resolveClaGroupContext` keys the PUT on). Hide Add/Edit/Remove only when the group carries neither a usable project SFID nor a foundation id.

## Impersonation

Writes stay blocked while impersonating. The permission check itself is a read, so the UI can still ask and refuse attestation Continue.

The roster flag and the CLA Managers tab's own-row mark are computed for the impersonated user, not the support engineer, so impersonating shows whether that user is on the CLA Manager list.

## What to tell a viewer who sees no approval-list, Invalidate, or Auto ECLA controls

Work out which of these applies:

- **Not on the CLA Manager list.** An organization admin is routinely not on it, even when ACS grants them the write. Ask a CLA manager on the agreement to add them as a CLA manager.
- **Added recently.** ACS can take about thirty minutes to reflect a new CLA manager. If they added themselves, the controls can also stay hidden until the page is reloaded. Wait, then reload.
- **On the list under a different spelling.** The match is exact, including case. A list entry whose LF username differs from their login only in case does not count, and the write is refused for the same reason. Raise it with EasyCLA support so the entry can be corrected.
- **The agreement has no CLA Manager list at all.** The controls are hidden from everyone on that row. This is a data problem on the EasyCLA record, so raise it with EasyCLA support.
- **No ACS grant** for that project and organization. Ask whether they hold the CLA manager role for it.

## What to tell a viewer who can see EasyCLA but cannot Review and Sign

They have Org Lens access (so they can read and see Sign) and no ACS signing grant for that project and organization. Ask whether they are a CLA signatory or CLA manager designee for that project. A grant made in the last half hour may not have reached ACS yet.
