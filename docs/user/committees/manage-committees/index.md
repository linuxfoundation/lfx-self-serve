---
title: Manage Committees
description: How to view and manage project committees in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Committees
tags: [committees, manage, members, governance, csv, import]
last_updated: 2026-10-28
intercom_collection: Committees
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** roles. Use the Committees section to view committee membership, update details, and manage your project's governance groups.

## View all committees

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Groups** from the left navigation sidebar.
3. The committees dashboard lists all committees for your active project or foundation context.
4. Select a committee name to open its detail view.

## View committee details

The committee detail view (route: `/groups/:id`) shows:

- Committee name and description
- Current members and their roles

To link directly to a tab, append `?tab=members` to the group URL for the Members roster, or use `tab=votes`, `tab=meetings`, or `tab=documents` for those tabs. Missing or invalid tab values open Overview. A recognized tab that is not visible to you also falls back to Overview; deep links do not change your access to the group.

## Edit a committee

1. Open a committee from the committees dashboard.
2. Select **Edit Group** in the group's header. The button appears only if you have write access to the group's project.
3. Update the committee name, description, or other fields.
4. Save your changes.

If you can edit the group but don't see **Edit Group**, select the pencil (**Edit description**) next to the group's description to change it, and use the **Settings** tab to change the name, type, or parent.

### Change the name, type, or parent from Settings

If you can edit the group, its **Settings** tab includes a **General** card:

- **Group Name** — required.
- **Group Type** — the group's category.
- **Parent Group (Optional)** — choose a top-level group in the same project, or **No Parent Group** to detach it. A group can't be its own parent.

Select **Save Changes**. If you changed the type, a **Change Group Type** confirmation appears because the change updates how the group is labeled and governed, including on its members' records. Select **Change Type** to save, or **Cancel** to go back.

## Add or remove members

1. Open the committee you want to update.
2. Navigate to the members section of the committee detail view.
3. Select the add member option, search for the person by name or email, and confirm.
4. Save your changes.

## Import members from a CSV

If you can manage a group's members, you can add many people at once from a CSV file. Import is available on an existing group's **Members** tab, in **Edit Group → Add Members**, and on the **Add Members** step when you create a new group. It does not send invitations or create groups.

### Import from the Members tab

1. Open the group and go to its **Members** tab.
2. Select **Import Members**, to the left of **Add Member**. The button becomes available after the group's members and pending invitations finish loading. Import refreshes both lists before opening the dialog; if either list cannot be loaded, no import opens and you can try again.
3. Select **Download template**. The template contains only the columns that apply to this group. Open **Column reference** to see which columns are required and the complete accepted role and appointed-by values.
4. Fill in one member per row and save the file as **CSV UTF-8 (comma delimited)**. Keep the template's lowercase column names; column order does not matter, and any other column is rejected.
5. Select **Choose CSV file**. Nothing is added yet — you see a preview of every row first.
6. Review the preview. Each row is **Ready**, **Invalid**, or **Skipped**, and invalid rows list their problems. To fix a value, correct the file and choose it again; you can also remove a row from the preview. The import cannot start while any row is invalid.
7. Optionally select **Send notification emails to added members**. Notifications are off by default, the same as **Add Member**.
8. Select **Add _N_ members**.

### Import while creating or editing a group

1. When creating a group, select **Create Group** on the **Settings** step to reach **Add Members**. When editing, open **Edit Group** and go to the **Add Members** step.
2. Select **Import Members** alongside **Invite by email** and **Add with details**.
3. Download the template or choose a CSV file, then review the preview. Required organization and voting fields reflect the group's current settings in the form.
4. Optionally select **Send notification emails to added members**. Notifications are off by default; this choice is retained when you edit staged members or move between steps.
5. Select **Import _N_ members**. The dialog closes and the imported members appear in the editable list with a **New** badge. Nothing has been saved yet; you can edit or remove them before saving.
6. Select **Done** (when creating) or **Update Group** (when editing) to save the pending member additions along with your other changes. Cancelling the CSV preview, selecting **Skip For Now**, or leaving without saving does not add those members or revoke their invitations. When creating, the group itself has already been saved; only the pending members are discarded.

**Done** and **Update Group** stay unavailable while member or group details are loading or could not be loaded. No pending changes are submitted in that state. Once the members step loads successfully, you can save; your staged additions, edits, removals, and invitations remain pending.

People already in the group or already staged in the form are skipped. Imports use the form's normal save flow rather than the Members tab's per-row results. After an imported member is successfully added, matching pending invitations are revoked. If cleanup fails, a warning directs you to revoke them from the **Pending** tab; the added member is not resubmitted when you retry other failed changes.

### What the CSV needs

- `email` is always required and must contain one valid email address, not a comma- or semicolon-separated list. Names, job title, LinkedIn profile, role and its dates, and appointed by are optional.
- Groups with voting or a business email requirement need `organization_name` and a full `https://` `organization_website` for every row. In any group, if you give one of the two you must give both.
- Voting groups also need `role` and `voting_status` (Voting Rep, Alternate Voting Rep, Observer, or Emeritus) for every row. Leave the voting columns empty for groups without voting.
- Dates use `YYYY-MM-DD`, and an end date cannot be before its start date.
- A file can have up to 500 member rows and be up to 5 MB. Split larger lists into several files.
- Usernames, member status, and group permissions can't be set from a CSV. Imported people get standard member access; change permissions afterwards from the member's **Edit** option.

### Members-tab results and retry

- People already in the group, and repeats of an email earlier in the file, are skipped and left unchanged. Emails are compared without regard to capitalization or surrounding spaces.
- After the import, each row shows **Added**, **Skipped**, or **Failed** with the reason. Select **Retry _N_ failed** to send only the failed rows again — added and skipped rows are never resubmitted.
- If your session expires, you lose permission to manage the group, or too many requests are sent, the import stops and rows that were not sent are marked **Failed** so you can retry them later. For too many requests, wait a minute before retrying.
- If an added person had a pending invitation, it is revoked. If that cleanup fails, the person is still added and the row says so; revoke the invitation from the **Pending** tab. Session, permission, missing-invitation, and rate-limit errors during cleanup also stop new member requests, but never resubmit the members already added.
- Select **Close** to return to the roster, which refreshes to show the new members. Newly added members can take a few moments to appear.

## Switch project context

Committees are scoped to a specific project or foundation. Use the lens switcher in the top navigation to change between your **Foundation**, **Project**, or **Me** views. The committees list updates automatically to reflect the selected context.

## Related

- [Create a Committee](../create-committee/) — steps to create a new committee
- [Votes](../../votes/) — run polls for committee decisions
