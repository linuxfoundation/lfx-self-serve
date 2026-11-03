---
title: Choose and switch an organization
description: Pick the organization you are viewing in the Organization lens, switch to another one, use the All Organizations Roll-Up combined view, read the organization in a page address, and understand the messages on a link that does not open an organization.
audience: [all]
product_area: Organization
tags: [organization, org, org-lens, switcher, switch-organization, all-organizations, combined-view, url, not-found, access]
last_updated: 2026-11-03
intercom_collection: Organization
---

These steps apply to anyone with access to at least one organization in the Organization lens, such as an organization admin (editor or viewer), a CLA (Contributor License Agreement) Manager, an initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager), or Linux Foundation staff. Admin and viewer access to an organization is granted by that organization's own Organization Lens administrators, not by the Linux Foundation.

The organization switcher at the top of the sidebar names what you are viewing, and every page in the lens (**Dashboard**, **Memberships**, **Projects**, and the rest) follows it. Usually that is a single organization. If you have access to two or more, the switcher also offers the **All Organizations Roll-Up**, a combined view across all of them.

## How do I choose an organization in the Organization lens?

You choose an organization from the organization switcher at the top of the sidebar, once you are in the Organization lens.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Organization** in the lens switcher. On a larger screen, you land on the **Dashboard** of the selected organization. On a phone or small screen, selecting **Organization** in the navigation menu only shows that lens's menu: select **Dashboard** in it to open the page. If your only role on that organization is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead, because that is the only page you can open for it, and on a phone or small screen **EasyCLA** is the only page in its menu. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).
3. Select the organization switcher at the top of the sidebar. It shows the organization's logo, its name, and your role on it.
4. Select an organization from the list. A check mark marks the one you are viewing.

The first time you open the Organization lens, LFX selects one of your organizations for you. It is not always the one where you have the most access, so check the name in the organization switcher and switch if you need a different one. Linux Foundation staff with no organizations assigned to them get no selection. The **Dashboard** says **No organization selected** until you search for an organization in the switcher and select it. Your browser remembers the organization you last selected for 30 days.

If you can open only one organization, the switcher shows that organization without a list to open, because there is nothing to switch to.

## How do I switch to a different organization?

Open the organization switcher at the top of the sidebar and select another organization. You stay on the same page, now showing the organization you picked, unless your only role on that organization is CLA Manager or initial CLA Manager designee: then you land on its **EasyCLA** page, the only page you can open for it.

1. Select the organization switcher at the top of the sidebar.
2. Select the organization you want. On a keyboard, use the arrow keys to move through the list and press Enter to select.

After a switch, the browser's Back button returns you to the organization you were viewing before. If the address you switched from had no organization in it, such as `/org` or `/org/projects`, Back takes you to the page you visited before that one instead. If you switched from a page that says a link does not open an organization, Back returns you to that page. An **Employees** selection on a page does not carry over to the new organization, because it was a list of the previous organization's people.

## What is the All Organizations Roll-Up?

The **All Organizations Roll-Up** is a combined view across every organization you have access to, instead of one at a time. It is useful when you administer several related companies and want to see them together rather than switching between them.

It appears as the first entry in the organization switcher, above your organizations and separated from them, with the line **Combined view of related organizations** and the number of organizations it covers. Selecting it is like selecting an organization: the switcher then shows **All Organizations Roll-Up** and, in place of your role, the number of organizations being combined. A view across several organizations has no single role, so no role is shown.

**When it is offered.** Only when you have access to two or more organizations. With access to one, there is nothing to combine, so the entry does not appear at all.

**What it covers.** Every organization on your list, including those you reach through access to a related organization. Organizations where your only role is CLA Manager or initial CLA Manager designee are not part of the combined view; manage those in the [Corporate CLA Console](https://corporate.lfcla.com).

To select it:

1. Select the organization switcher at the top of the sidebar.
2. Select **All Organizations Roll-Up** at the top of the list. On a keyboard, use the arrow keys to reach it and press Enter.

To leave it, open the switcher again and select a single organization.

Searching does not hide it: when a search matches none of your organizations, the **All Organizations Roll-Up** stays at the top of the list and **No organizations found** appears below it, so you can always get back to the combined view.

Like an organization, your choice is remembered for 30 days, and the address names it, so a link to a combined page opens as a combined page for anyone else who can use it. See [What does the organization in a page address mean?](#what-does-the-organization-in-a-page-address-mean) below.

If your access later changes so that you can reach only one organization, the combined view is no longer available. LFX moves you to one of your organizations and the page you were on reloads for it, rather than leaving you on a view you can no longer use.

## What does my role in the organization switcher mean?

The line under the organization's name in the switcher is your role on that organization. Hover over it to see what it lets you do.

| Role in the switcher               | What it means                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Org Admin Editor**               | You can view and edit this organization's profile, members and settings                                                                 |
| **Org Admin Viewer**               | You can view this organization's details, but not edit them                                                                             |
| **Org Admin Editor (Inherited)**   | You can view and edit this organization through your admin access to a related organization                                             |
| **Org Admin Viewer (Inherited)**   | You can view this organization through your access to a related organization                                                            |
| **(Original)** after a direct role | Your role was granted directly on this organization. The label is added when some of your other access comes from related organizations |

In the list of organizations, hovering over an inherited role shows **Inherited from your access to** followed by the related organization's name. If the line says **Organization** instead of a role, you have no admin role on that organization.

## Why can't I search for an organization in the switcher?

Only Linux Foundation staff can search the switcher. Everyone else sees a list of the organizations they have access to, with no search box. If you have an admin or viewer role on any organization, the list leaves out organizations where your only role is CLA Manager or initial CLA Manager designee. Manage those organizations' corporate CLAs in the [Corporate CLA Console](https://corporate.lfcla.com).

For Linux Foundation staff, the switcher opens with a **Search organizations...** box. Type at least two characters to search every organization. Until you do, an empty list shows **Search for any organization…**. When the results include organizations you are not assigned to, the ones you are assigned to are listed under **Your organizations** and the rest under **All organizations**. Each organization under **All organizations** carries a **Member** or **Non-member** label for its Linux Foundation membership.

Other messages in the switcher:

- **No organizations found** — nothing matches your search, or you have no organizations to list.
- **Search is unavailable right now. Try again shortly.** — the search could not run. Try again in a moment.
- **Some of your organizations may be missing from this list. Retry to reload.** — part of your list did not load. Select **Retry** to reload it. You can still select the organizations that are listed.

## What does the organization in a page address mean?

Every Organization lens page address names the organization it shows, in the form `/org/<organization>/<page>`. For example, `app.lfx.dev/org/<organization>/projects` opens the **Projects** page of that organization.

- `<organization>` is the organization's short name, in lowercase letters, numbers, and hyphens. An organization without a short name is addressed by its 18-character account ID, which starts with `001`.
- `/org/<organization>` on its own opens that organization's **Dashboard**, or its **EasyCLA** page when your only role on it is CLA Manager or initial CLA Manager designee.
- `/org/all/<page>` is the combined view: it opens **All Organizations Roll-Up** on that page. `all` is reserved for it, so an organization whose short name would be `all` is addressed by its account ID instead. Opening a `/org/all` address switches you to the combined view, the same way an organization address switches you to that organization. If you have access to only one organization, the combined view is not yours to open: LFX opens the page for your organization instead, and if it cannot, you land on the page described below.
- A link you share names the organization, so the person who opens it sees the same organization, as long as they have access to it.
- An older address without an organization, such as `/org/projects`, still opens. It shows the organization you have selected, which may not be the one the sender was viewing. The address usually fills in that organization's name when the page loads, but not always, so before you share a link, check that it reads `/org/<organization>/<page>`.

Opening an address for an organization you have access to switches your selection to that organization, as if you had picked it in the switcher.

## What happens when a link does not open an organization?

When a link names an organization that does not exist, that you do not have access to, or that cannot be loaded right now, you land on a page that says why, in place of the organization's pages. The page never names the organization in the link, so a link cannot reveal an organization you have no access to. A link that names the organization by its short name also lands here when the lookup fails for a moment, so try a link you trust again before asking for access.

| Message                                                                                                                                                              | What it means and what to do                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **You do not have access to this organization**, with **This link points to an organization that is not on your list.**                                              | The organization in the link is not one you have access to, but you have access to others. Select one of the organizations listed under the message to open it. If your list has not loaded, no organizations are listed. To get access to the organization in the link, select **Ask for access to the organization in this link**.                                                                     |
| **You do not have access to this organization**, with **Access is granted by the organization's own Organization Lens administrators, not by the Linux Foundation.** | You do not have access to any organization in the Organization lens. Ask your organization's Organization Lens administrators to grant you access. If you are not sure who they are, your company's open source program office (OSPO) is a good place to start. For help, select **Contact support**. To see public open source activity without access, select **See public activity in LFX Insights**. |
| **This link does not open an organization**                                                                                                                          | For Linux Foundation staff: LFX could not open an organization from this link. Usually no organization matches it, but a lookup that failed for a moment shows the same message. Try the link again, search for the organization in the switcher, or select **Go to Organization Lens**.                                                                                                                 |
| **Some organizations could not be loaded**                                                                                                                           | A temporary problem loading your organizations. Nothing has been removed from your access. Select **Retry**.                                                                                                                                                                                                                                                                                             |
| **We could not confirm your staff access**                                                                                                                           | The staff access check did not complete, and your permissions have not changed. Select **Retry**. If it keeps failing, select **Still failing? Send this reference to support** and include the reference shown on the page.                                                                                                                                                                             |

## Related sections

- [Organization](../) — what the Organization lens covers
- [EasyCLA](../easycla/) — corporate CLAs (Contributor License Agreements) for the selected organization
- [Organization FAQ](../faq/) — short answers about the Organization lens
