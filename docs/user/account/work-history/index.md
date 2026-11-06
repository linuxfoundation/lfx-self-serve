---
title: Work history & Affiliations
description: Manage your work history and see how your project affiliations and contribution attribution are calculated in LFX Self Serve
audience: [all]
product_area: Account
tags: [account, work-history, affiliations, project-involvement, attribution, maintainer]
last_updated: 2026-11-05
intercom_collection: Account
---

The **Work history & Affiliations** tab is where you record your employment history and review how your open-source contributions are attributed to organizations. It has two sections — **Work history** and **Project Involvement** — and it is the tab that opens by default under the Profile & Account hub at `/profile/attributions`.

## What you can do

- Add, edit, and delete work experience entries, and mark your current employer
- See how your project contributions are attributed to organizations over time
- Confirm or adjust your affiliation history when the system needs it
- See whether a project lists you as a maintainer or a contributor

## Open Work history & Affiliations

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select [**Profile & Account**](/profile) from the left navigation sidebar.
3. You land on the **Work history & Affiliations** tab by default, or go directly to `/profile/attributions`.

## Work history

Your employment history determines which organization your contributions are attributed to. Your work experience also populates the **Organization** choices in the [Edit Profile drawer](../../profile/edit-profile/#set-your-organization).

Your entries appear in a table with **Organization**, **Job Title**, and **Dates** columns.

### Add a work experience

1. Select **Add work experience**.
2. In the **Add work experience** dialog, fill in the fields. **Organization**, **Role**, and **Start Date** are marked required (`*`):
   - **Organization** — search and pick your employer (for example, `Google`, `Red Hat`).
   - **Role** — your job title (for example, `Senior Software Engineer`).
   - **Start Date** — month and year.
   - **End Date** — month and year, or select **I currently work here** to mark it as your current role (this hides the end date).
3. Select **Add experience**.

> **Note:** This information is used to compute your project affiliations.

### Edit or delete a work experience

- Open the actions menu on an entry and select **Edit**. The **Edit work experience** dialog opens; change the fields, then select **Save changes**.
- To remove an entry, select **Delete**. The **Delete work experience** dialog asks _Are you sure you want to delete this work experience? This action cannot be undone._ — confirm with **Delete experience**.

If you have no entries yet, the section shows _No work experience added_ — _Add your employment history to improve the accuracy of your project affiliations._ Use **Add work experience** to get started.

## Project Involvement (affiliations)

This section shows your role and affiliation for each project you're involved in, whether through code, events, training, or other activity. Affiliations are calculated automatically — you don't add projects manually.

Only projects that LFX tracks appear here. Activity in a personal repository, or in a project LFX doesn't track, is not shown.

Your contributions are attributed based on three inputs (see the **How affiliations work** dialog on the tab):

- **Verified identities** — your connected accounts (such as GitHub) and verified email addresses link activity to you.
- **Work experience** — tells us which organization you represented during each time period.
- **Contribution timestamp overlap** — matching when you contributed against your employment dates attributes each contribution to the right organization.

### Confirm or adjust your affiliation history

When the system attributes contributions from your employment timeline, you may see an **Affiliations calculated from work history** banner: _We've attributed your project contributions based on your employment timeline. Confirm or adjust if needed._ Select **Confirm Affiliation History** (or **Edit Affiliation** on a project) to open the affiliation editor, where you can adjust the organization and dates per project and override anything the system got wrong.

### Maintainer and Contributor labels

A project card can show a **Maintainer** or **Contributor** label. It comes from the project's data: either the project's repository configuration file (marked with a lock icon and the tooltip _Role defined in repository configuration file._) or maintainer activity LFX detected. When LFX detects that you may be a maintainer, the label shows a question-mark icon; select it to open the **Verify your role** dialog and choose **Yes, I'm a maintainer** or **No, I'm a contributor**.

> **Note:** This label describes your involvement only. It does not grant any access to the project, and a **Contributor** label can't be changed to **Maintainer** here. Access to a project is granted by a project manager on the project's **Permissions** page. See [Permissions](../../permissions/).

If you haven't connected any identities or added work experience yet, the section shows _No project affiliations yet_. Once you have connected an identity, even one you haven't verified yet, or added work experience, it shows _No project contributions found_ until LFX finds contributions to a tracked project. Only verified identities are used to find your contributions, so if you see this message, check that the accounts you contribute with are verified on the [Identities](../identities/) tab. Both messages show buttons to **Verify identities** and **Add work experience**.

## Related

- [Account overview](../) — all account areas and navigation
- [Identities](../identities/) — verified identities feed contribution attribution
- [Edit your profile](../../profile/edit-profile/#set-your-organization) — the Organization field is populated from your work history
- [Account FAQ](../faq/) — short answers about affiliations and account areas
- [Permissions](../../permissions/) — how access to a project is actually granted
