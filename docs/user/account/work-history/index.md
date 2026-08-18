---
title: Work history & Affiliations
description: Manage your work history and see how your project affiliations and contribution attribution are calculated in LFX Self Serve
audience: [all]
product_area: Account
tags: [account, work-history, affiliations, project-involvement, attribution, maintainer]
last_updated: 2026-08-17
intercom_collection: Account
---

The **Work history & Affiliations** tab is where you record your employment history and review how your open-source contributions are attributed to organizations. It has two sections — **Work history** and **Project Involvement** — and it is the tab that opens by default under the Profile & Account hub at `/profile/attributions`.

## What you can do

- Add, edit, and delete work experience entries, and mark your current employer
- See how your project contributions are attributed to organizations over time
- Confirm or adjust your affiliation history when the system needs it
- Confirm whether you are a maintainer or a contributor on a project

## Open Work history & Affiliations

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select [**Profile & Account**](/profile) from the left navigation sidebar.
3. You land on the **Work history & Affiliations** tab by default, or go directly to `/profile/attributions`.

## Work history

Your employment history determines which organization your contributions are attributed to. Your work experience also populates the **Organization** choices in the [Edit Profile drawer](../../profile/edit-profile/#set-your-organization).

### Add a work experience

1. Select **Add work experience**.
2. Fill in the fields (only **Role** is required):
   - **Organization** — search and pick your employer (for example, `Google`, `Red Hat`).
   - **Role** (required) — your job title (for example, `Senior Software Engineer`).
   - **Start Date** — month and year.
   - **End Date** — month and year, or select **I currently work here** to mark it as your current role (this hides the end date).
3. Select **Add experience**.

> **Note:** This information is used to compute your project affiliations.

### Edit or delete a work experience

- Open the actions menu on an entry and select **Edit**, change the fields, then select **Save changes**.
- To remove an entry, select **Delete** and confirm with **Delete experience**. This can't be undone.

If you have no entries yet, the section shows _No work experience added_ — use **Add work experience** to get started.

## Project Involvement (affiliations)

This section shows your role and organizational affiliation for each open-source project you contribute to. Affiliations are calculated automatically — you don't add projects manually.

Your contributions are attributed based on three inputs (see the **How affiliations work** dialog on the tab):

- **Verified identities** — your connected accounts (such as GitHub) and verified email addresses link activity to you.
- **Work experience** — tells us which organization you represented during each time period.
- **Contribution timestamp overlap** — matching when you contributed against your employment dates attributes each contribution to the right organization.

### Confirm or adjust your affiliation history

When the system attributes contributions from your employment timeline, you may see a prompt: _We've attributed your project contributions based on your employment timeline. Confirm or adjust if needed._ Select **Confirm Affiliation History** (or **Edit Affiliation** on a project) to open the affiliation editor, where you can adjust the organization and dates per project and override anything the system got wrong.

### Confirm your maintainer or contributor role

If the system detects you may be a maintainer, it asks you to verify: in the **Verify your role** dialog, choose **Yes, I'm a maintainer** or **No, I'm a contributor**. A role that comes from a project's repository configuration file is marked with a lock icon and the tooltip _Role defined in repository configuration file_; you can still open the role menu and change it to **Contributor** if it's wrong.

If nothing is linked yet, the section shows _No project affiliations yet_ with prompts to **Verify identities** and **Add work experience**.

## Related

- [Account overview](../) — all account areas and navigation
- [Identities](../identities/) — verified identities feed contribution attribution
- [Edit your profile](../../profile/edit-profile/#set-your-organization) — the Organization field is populated from your work history
- [Account FAQ](../faq/) — short answers about affiliations and account areas
