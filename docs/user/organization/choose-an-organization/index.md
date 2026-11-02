---
title: Choose and switch an organization
description: Pick the organization you are viewing in the Organization lens, switch to another one, read the organization in a page address, and understand the messages on a link that does not open an organization.
audience: [all]
product_area: Organization
tags: [organization, org, org-lens, switcher, switch-organization, url, not-found, access]
last_updated: 2026-11-02
intercom_collection: Organization
---

These steps apply to anyone with access to at least one organization in the Organization lens, such as an organization admin (editor or viewer) or Linux Foundation staff. Access to an organization is granted by that organization's own Organization Lens administrators, not by the Linux Foundation.

The Organization lens always shows one organization at a time. The organization switcher at the top of the sidebar names the organization you are viewing, and every page in the lens (**Dashboard**, **Memberships**, **Projects**, and the rest) is about that organization.

## How do I choose an organization in the Organization lens?

You choose an organization from the organization switcher at the top of the sidebar, once you are in the Organization lens.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Organization** in the lens switcher. You land on the **Dashboard** of the organization that is already selected.
3. Select the organization switcher at the top of the sidebar. It shows the organization's logo, its name, and your role on it.
4. Select an organization from the list. A check mark marks the one you are viewing.

The first time you open the Organization lens, an organization is selected for you: one where you have the most access, with an organization you can edit ahead of one you can only view. Your browser remembers the organization you last selected for 30 days.

If you can open only one organization, the switcher shows that organization without a list to open, because there is nothing to switch to.

## How do I switch to a different organization?

Open the organization switcher at the top of the sidebar and select another organization. You stay on the same page, now showing the organization you picked.

1. Select the organization switcher at the top of the sidebar.
2. Select the organization you want. On a keyboard, use the arrow keys to move through the list and press Enter to select.

After a switch, the browser's Back button returns you to the organization you were viewing before. An **Employees** selection on a page does not carry over to the new organization, because it was a list of the previous organization's people.

## What does my role in the organization switcher mean?

The line under the organization's name in the switcher is your role on that organization. Hover over it to see what it lets you do.

| Role in the switcher               | What it means                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Org Admin Editor**               | You can view and edit this organization's profile, members and settings                                                                 |
| **Org Admin Viewer**               | You can view this organization's details, but not edit them                                                                             |
| **Org Admin Editor (Inherited)**   | You can view and edit this organization through your admin access to a related organization                                             |
| **Org Admin Viewer (Inherited)**   | You can view this organization through your access to a related organization                                                            |
| **(Original)** after a direct role | Your role was granted directly on this organization. The label is added when some of your other access comes from related organizations |

An inherited role names the related organization it comes from when you hover over it: **Inherited from your access to** that organization. If the line says **Organization** instead of a role, you have no admin role on that organization.

## Why can't I search for an organization in the switcher?

Only Linux Foundation staff can search the switcher. Everyone else sees a list of the organizations they have access to, with no search box.

For Linux Foundation staff, the switcher opens with a **Search organizations...** box. Type at least two characters to search every organization. Until you do, an empty list shows **Search for any organization…**. When the results include organizations you are not assigned to, the ones you are assigned to are listed under **Your organizations** and the rest under **All organizations**, each with a **Member** or **Non-member** label for its Linux Foundation membership.

Other messages in the switcher:

- **No organizations found** — nothing matches your search, or you have no organizations to list.
- **Search is unavailable right now. Try again shortly.** — the search could not run. Try again in a moment.
- **Some of your organizations may be missing from this list. Retry to reload.** — part of your list did not load. Select **Retry** to reload it. You can still select the organizations that are listed.

## What does the organization in a page address mean?

Every Organization lens page address names the organization it shows, in the form `/org/<organization>/<page>`. For example, `app.lfx.dev/org/<organization>/projects` opens the **Projects** page of that organization.

- `<organization>` is the organization's short name, in lowercase letters, numbers, and hyphens. An organization without a short name is addressed by its 18-character account ID, which starts with `001`.
- `/org/<organization>` on its own opens that organization's **Dashboard**.
- A link you share names the organization, so the person who opens it sees the same organization, as long as they have access to it.
- An older address without an organization, such as `/org/projects`, still works. It shows the organization you have selected, and the address then fills in that organization's name.

Opening an address for an organization you have access to switches your selection to that organization, as if you had picked it in the switcher.

## What happens when a link does not open an organization?

When a link names an organization that does not exist, that you do not have access to, or that cannot be loaded right now, you land on a page that says why, in place of the organization's pages. The page never names the organization in the link, so a link cannot reveal an organization you have no access to.

| Message                                                                                                                                                              | What it means and what to do                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **You do not have access to this organization**, with **This link points to an organization that is not on your list.**                                              | The organization in the link is not one you have access to, but you have access to others. Select one of the organizations listed under the message to open it. If your list has not loaded, no organizations are listed. To get access to the organization in the link, select **Ask for access to the organization in this link**.                                                                     |
| **You do not have access to this organization**, with **Access is granted by the organization's own Organization Lens administrators, not by the Linux Foundation.** | You do not have access to any organization in the Organization lens. Ask your organization's Organization Lens administrators to grant you access. If you are not sure who they are, your company's open source program office (OSPO) is a good place to start. For help, select **Contact support**. To see public open source activity without access, select **See public activity in LFX Insights**. |
| **This link does not open an organization**                                                                                                                          | For Linux Foundation staff: no organization matches this link. Search for the organization in the switcher, or select **Go to Organization Lens**.                                                                                                                                                                                                                                                       |
| **Contractor accounts need an organization grant**                                                                                                                   | Linux Foundation contractor accounts no longer see every organization automatically. Ask that organization's Organization Lens administrators to grant you access. For help, select **Contact support**.                                                                                                                                                                                                 |
| **Some organizations could not be loaded**                                                                                                                           | A temporary problem loading your organizations. Nothing has been removed from your access. Select **Retry**.                                                                                                                                                                                                                                                                                             |
| **We could not confirm your staff access**                                                                                                                           | The staff access check did not complete, and your permissions have not changed. Select **Retry**. If it keeps failing, select **Still failing? Send this reference to support** and include the reference shown on the page.                                                                                                                                                                             |

## Related sections

- [Organization](../) — what the Organization lens covers
- [EasyCLA](../easycla/) — corporate CLAs (Contributor License Agreements) for the selected organization
- [Organization FAQ](../faq/) — short answers about the Organization lens
