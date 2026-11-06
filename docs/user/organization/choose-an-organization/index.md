---
title: Choose and switch an organization
description: Pick the organization you are viewing in the Organization lens, switch to another one, read the organization in a page address, and understand the messages on a link that does not open an organization.
audience: [all]
product_area: Organization
tags: [organization, org, org-lens, switcher, switch-organization, url, not-found, access]
last_updated: 2026-11-06
intercom_collection: Organization
---

These steps apply to anyone with access to at least one organization in the Organization lens, such as an organization admin (editor or viewer), a CLA (Contributor License Agreement) Manager, or an initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager). Admin and viewer access to an organization is granted by that organization's own Organization Lens administrators, not by the Linux Foundation.

The Organization lens always shows one organization at a time. The organization switcher at the top of the sidebar names the organization you are viewing, and every page in the lens (**Dashboard**, **Memberships**, **Projects**, and the rest) is about that organization.

## How do I choose an organization in the Organization lens?

You choose an organization from the organization switcher at the top of the sidebar, once you are in the Organization lens.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Organization** in the lens switcher. On a larger screen, you land on the **Dashboard** of the selected organization. On a phone or small screen, selecting **Organization** in the navigation menu only shows that lens's menu: select **Dashboard** in it to open the page. If your only role on that organization is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead, because that is the only page you can open for it, and on a phone or small screen **EasyCLA** is the only page in its menu. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).
3. Select the organization switcher at the top of the sidebar. It shows the organization's logo, its name, and your role on it.
4. Select an organization from the list. A check mark marks the one you are viewing.

The first time you open the Organization lens, LFX selects one of your organizations for you. It is not always the one where you have the most access, so check the name in the organization switcher and switch if you need a different one. Your browser remembers the organization you last selected for 30 days.

If you can open only one organization, the switcher shows that organization without a list to open, because there is nothing to switch to.

## How do I switch to a different organization?

Open the organization switcher at the top of the sidebar and select another organization. You stay on the same page, now showing the organization you picked, unless your only role on that organization is CLA Manager or initial CLA Manager designee: then you land on its **EasyCLA** page, the only page you can open for it.

1. Select the organization switcher at the top of the sidebar.
2. Select the organization you want. On a keyboard, use the arrow keys to move through the list and press Enter to select.

After a switch, the browser's Back button returns you to the organization you were viewing before. If the address you switched from had no organization in it, such as `/org` or `/org/projects`, Back takes you to the page you visited before that one instead. If you switched from a page that says why a link did not open an organization, Back returns you to that page. An **Employees** selection on a page does not carry over to the new organization, because it was a list of the previous organization's people.

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

## Why is an organization missing from the switcher?

The organization switcher lists the organizations where you have an admin or viewer role, including a role inherited from a related organization. It lists organizations where your only role is CLA Manager or initial CLA Manager designee only when you have no admin or viewer role on any organization, and each of those opens on its **EasyCLA** page. So if you are an admin or viewer on even one organization, an organization where you are only a CLA Manager or initial CLA Manager designee is missing from the switcher.

Messages in the switcher:

- **No organizations found** — you have no organizations to list.
- **Some of your organizations may be missing from this list. Retry to reload.** — part of your list did not load. Select **Retry** to reload it. You can still select the organizations that are listed.

## What does the organization in a page address mean?

Every Organization lens page address names the organization it shows, in the form `/org/<organization>/<page>`. For example, `app.lfx.dev/org/<organization>/projects` opens the **Projects** page of that organization.

- `<organization>` is the organization's short name, in lowercase letters, numbers, and hyphens. An organization without a short name is addressed by its 18-character account ID, which starts with `001`.
- `/org/<organization>` on its own opens that organization's **Dashboard**, or its **EasyCLA** page when your only role on it is CLA Manager or initial CLA Manager designee.
- A link you share names the organization, so the person who opens it sees the same organization, as long as they have access to it.
- An older address without an organization, such as `/org/projects`, still opens. It shows the organization you have selected, which may not be the one the sender was viewing. The address usually fills in that organization's name when the page loads, but not always, so before you share a link, check that it reads `/org/<organization>/<page>`.

Opening an address for an organization you have access to switches your selection to that organization, as if you had picked it in the switcher.

## What happens when a link does not open an organization?

When a link names an organization that does not exist, that you do not have access to, or that cannot be loaded right now, you land on a page that says why, in place of the organization's pages. The page never names the organization in the link, so a link cannot reveal an organization you have no access to. A link that names the organization by its short name also lands here when the lookup fails for a moment, so try a link you trust again before asking for access.

| Message                                                                                                                                                              | What it means and what to do                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **You do not have access to this organization**, with **This link points to an organization that is not on your list.**                                              | The organization in the link is not one you have access to, but you have access to others. Select one of the organizations listed under the message to open it. If your list has not loaded, no organizations are listed. To get access to the organization in the link, select **Ask for access to the organization in this link**.                                                                     |
| **You do not have access to this organization**, with **Access is granted by the organization's own Organization Lens administrators, not by the Linux Foundation.** | You do not have access to any organization in the Organization lens. Ask your organization's Organization Lens administrators to grant you access. If you are not sure who they are, your company's open source program office (OSPO) is a good place to start. For help, select **Contact support**. To see public open source activity without access, select **See public activity in LFX Insights**. |
| **Some organizations could not be loaded**                                                                                                                           | A temporary problem loading your organizations. Nothing has been removed from your access. Select **Retry**.                                                                                                                                                                                                                                                                                             |

## Related sections

- [Organization](../) — what the Organization lens covers
- [EasyCLA](../easycla/) — corporate CLAs (Contributor License Agreements) for the selected organization
- [Organization FAQ](../faq/) — short answers about the Organization lens
