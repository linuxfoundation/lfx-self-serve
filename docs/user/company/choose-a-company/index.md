---
title: Choose and switch a company
description: Pick the company you are viewing in the Company lens, switch to another one, read the company in a page address, and understand the messages on a link that does not open a company.
audience: [all]
product_area: Company
tags: [company, org, org-lens, switcher, switch-company, url, not-found, access]
last_updated: 2026-11-06
intercom_collection: Company
---

These steps apply to anyone with access to at least one company in the Company lens, such as a company admin (editor or viewer), a CLA (Contributor License Agreement) Manager, or an initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager). Admin and viewer access to a company is granted by that company's own Company Lens administrators, not by the Linux Foundation.

The Company lens always shows one company at a time. The company switcher at the top of the sidebar names the company you are viewing, and every page in the lens (**Dashboard**, **Memberships**, **Projects**, and the rest) is about that company.

## How do I choose a company in the Company lens?

You choose a company from the company switcher at the top of the sidebar, once you are in the Company lens.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Company** in the lens switcher. On a larger screen, you land on the **Dashboard** of the selected company. On a phone or small screen, selecting **Company** in the navigation menu only shows that lens's menu: select **Dashboard** in it to open the page. If your only role on that company is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead, because that is the only page you can open for it, and on a phone or small screen **EasyCLA** is the only page in its menu. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).
3. Select the company switcher at the top of the sidebar. It shows the company's logo, its name, and your role on it.
4. Select a company from the list. A check mark marks the one you are viewing.

The first time you open the Company lens, LFX selects one of your companies for you. It is not always the one where you have the most access, so check the name in the company switcher and switch if you need a different one. Your browser remembers the company you last selected for 30 days.

If you can open only one company, the switcher shows that company without a list to open, because there is nothing to switch to.

## How do I switch to a different company?

Open the company switcher at the top of the sidebar and select another company. You stay on the same page, now showing the company you picked, unless your only role on that company is CLA Manager or initial CLA Manager designee: then you land on its **EasyCLA** page, the only page you can open for it.

1. Select the company switcher at the top of the sidebar.
2. Select the company you want. On a keyboard, use the arrow keys to move through the list and press Enter to select.

After a switch, the browser's Back button returns you to the company you were viewing before. If the address you switched from had no company in it, such as `/org` or `/org/projects`, Back takes you to the page you visited before that one instead. If you switched from a page that says why a link did not open a company, Back returns you to that page. An **Employees** selection on a page does not carry over to the new company, because it was a list of the previous company's people.

## What does my role in the company switcher mean?

The line under the company's name in the switcher is your role on that company. Hover over it to see what it lets you do.

| Role in the switcher               | What it means                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Org Admin Editor**               | You can view and edit this company's profile, members and settings                                                             |
| **Org Admin Viewer**               | You can view this company's details, but not edit them                                                                         |
| **Org Admin Editor (Inherited)**   | You can view and edit this company through your admin access to a related company                                              |
| **Org Admin Viewer (Inherited)**   | You can view this company through your access to a related company                                                             |
| **(Original)** after a direct role | Your role was granted directly on this company. The label is added when some of your other access comes from related companies |

In the list of companies, hovering over an inherited role shows **Inherited from your access to** followed by the related company's name. If the line says **Company** instead of a role, you have no admin role on that company.

## Why is a company missing from the switcher?

The company switcher lists the companies where you have an admin or viewer role, including a role inherited from a related company. It lists companies where your only role is CLA Manager or initial CLA Manager designee only when you have no admin or viewer role on any company, and each of those opens on its **EasyCLA** page. So if you are an admin or viewer on even one company, a company where you are only a CLA Manager or initial CLA Manager designee is missing from the switcher.

Messages in the switcher:

- **No companies found** — you have no companies to list.
- **Some of your companies may be missing from this list. Retry to reload.** — part of your list did not load. Select **Retry** to reload it. You can still select the companies that are listed.

## What does the company in a page address mean?

Every Company lens page address names the company it shows, in the form `/org/<company>/<page>`. For example, `app.lfx.dev/org/<company>/projects` opens the **Projects** page of that company.

- `<company>` is the company's short name, in lowercase letters, numbers, and hyphens. A company without a short name is addressed by its 18-character account ID, which starts with `001`.
- `/org/<company>` on its own opens that company's **Dashboard**, or its **EasyCLA** page when your only role on it is CLA Manager or initial CLA Manager designee.
- A link you share names the company, so the person who opens it sees the same company, as long as they have access to it.
- An older address without a company, such as `/org/projects`, still opens. It shows the company you have selected, which may not be the one the sender was viewing. The address usually fills in that company's name when the page loads, but not always, so before you share a link, check that it reads `/org/<company>/<page>`.

Opening an address for a company you have access to switches your selection to that company, as if you had picked it in the switcher.

## What happens when a link does not open a company?

When a link names a company that does not exist, that you do not have access to, or that cannot be loaded right now, you land on a page that says why, in place of the company's pages. The page never names the company in the link, so a link cannot reveal a company you have no access to. A link that names the company by its short name also lands here when the lookup fails for a moment, so try a link you trust again before asking for access.

| Message                                                                                                                                               | What it means and what to do                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **You do not have access to this company**, with **This link points to a company that is not on your list.**                                          | The company in the link is not one you have access to, but you have access to others. Select one of the companies listed under the message to open it. If your list has not loaded, no companies are listed. To get access to the company in the link, select **Ask for access to the company in this link**.                                                                        |
| **You do not have access to this company**, with **Access is granted by the company's own Company Lens administrators, not by the Linux Foundation.** | You do not have access to any company in the Company lens. Ask your company's Company Lens administrators to grant you access. If you are not sure who they are, your company's open source program office (OSPO) is a good place to start. For help, select **Contact support**. To see public open source activity without access, select **See public activity in LFX Insights**. |
| **Some companies could not be loaded**                                                                                                                | A temporary problem loading your companies. Nothing has been removed from your access. Select **Retry**.                                                                                                                                                                                                                                                                             |

## Related sections

- [Company](../) — what the Company lens covers
- [EasyCLA](../easycla/) — corporate CLAs (Contributor License Agreements) for the selected company
- [Company FAQ](../faq/) — short answers about the Company lens
