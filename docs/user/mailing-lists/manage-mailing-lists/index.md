---
title: Manage Mailing Lists
description: How to find mailing lists, join or leave one, open a list's page, and edit a list in LFX Self Serve.
audience: [all]
product_area: Mailing Lists
tags: [mailing-lists, join, leave, subscribe, filters, edit, linked groups]
last_updated: 2026-10-28
intercom_collection: Mailing Lists
---

Use this article to find the mailing lists for a project, join or leave a list, and, if you manage lists, open and edit them.

## Open the Mailing Lists page

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Choose where you want to look:
   - **A project or foundation.** Use the project picker in the sidebar, then select **Mailing Lists**. You see the lists that belong to that project or foundation.
   - **Your own view (Me).** Select **Mailing Lists** in the sidebar. You see only the lists you are subscribed to, across all foundations and projects.

If a project has no lists, you see "No mailing lists yet. This project has no mailing lists set up yet." In your own view, an empty page says "Mailing lists you're subscribed to will appear here." If the project has no mailing list service at all, see [Create a Mailing List](../create-mailing-list/).

## What the page shows

The summary cards at the top change with the view:

- **Project or foundation:** **Total Mailing Lists**, **Total Subscribers**, and **Public Lists**
- **Your own view:** **Total Mailing Lists**, **On Digest** (how many of your lists send you a digest), and **Public Lists**

Each row shows the list's name, its email address, and an **Open on Groups.io** link. The columns depend on the view:

| View                                    | Columns                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Project or foundation, can manage lists | **Mailing List**, **Description**, **Public**, **Posting**, **Linked Groups**, **Subscribers**                            |
| Project or foundation, other users      | **Mailing List**, **Description**, **Linked Groups**, **Public**, **Subscribers**, and a **Join** button where it applies |
| Your own view                           | **Mailing List**, **Description**, **My Subscription**, **Public**, and a leave button                                    |

A **Public** check mark means the list's archive is public. A **Member** badge next to a list name means you are already subscribed. **My Subscription** shows how you receive email from the list, for example **Individual**, **Digest**, or **None**. It shows **Subscribed** when no delivery mode is available.

If you are signed in with the board member persona, list names on a project or foundation page are plain text instead of links, and there is no **Join** button. You can still open a list by selecting its row.

## Find a list

- **Search mailing lists…** matches the list's name and description.
- **Select Committee** is the group filter. Choose a group to see only the lists linked to it. Its options start with **All Groups**.
- **Select Status** filters to **Public** or **Private** lists. Its options start with **All Status** and show how many lists are in each.
- In your own view, **foundation** and **project** filters can also appear. They depend on your roles and on which foundations and projects your subscribed lists belong to.

If nothing matches, you see "No results found". Select **Reset filters** to clear them.

The list shows 10 mailing lists per page, and you can switch to 25 or 50. Lists are sorted by name.

## Join a list

1. Find the list on the project or foundation page.
2. Select **Join** at the end of the row.

You are subscribed with the email address on your account, and you receive messages individually. You see "Joined mailing list" and "You have joined" followed by the list's name. It can take a moment for the page to show your new subscription.

**Join** only appears when:

- The list's **Audience & Access** is **Public**. For **Approval Required** and **Invite Only** lists, someone who manages the list adds you. See [Mailing List Settings and Visibility](../mailing-list-settings/).
- You are not already subscribed.
- You don't manage mailing lists for this project. The view for people who manage lists has no **Join** button. To add yourself, use **Add Subscriber** on the list's page. See [Manage Subscribers](../manage-subscribers/).
- Your subscriptions have finished loading. If they couldn't be loaded, **Join** is hidden so you aren't offered a list you already belong to.

If joining fails, you see "Failed to join" followed by the list's name. Try again.

## Leave a list

1. Switch to your own view (**Me**) and select **Mailing Lists**.
2. Select the leave icon (**Leave Mailing List**) at the end of the row.
3. In the **Leave Mailing List** dialog, select **Leave** to confirm, or **Cancel**.

The dialog warns "You will no longer receive emails from this list." You then see "Left mailing list" and "You have left" followed by the list's name.

If a list is kept in sync with a group, the dialog and an information icon in the **My Subscription** column warn that leaving may not persist if your role in that group changes.

If the leave icon is greyed out, LFX Self Serve can't find your subscription record for that list, so you can't leave from here. Contact the people who manage the list.

If leaving fails, you see "Failed to leave" followed by the list's name. Try again.

## Open a list's page

Select a list's name to open its page. The top shows:

- The list's name and description
- A **Public** or **Private** tag
- The number of subscribers
- The list's email address
- **View on Groups.io**, which opens the list on Groups.io

If you came from your own view, a note says "You're viewing this mailing list in its" followed by "project" or "foundation" and "context", and explains that some options may differ from your personal view. Use **Back to Mailing Lists** to return.

Below that are:

- **Linked Groups**: groups whose members are automatically subscribed to the list, or "No groups linked to this mailing list". **Manage Groups** opens the edit form so you can change the link.
- **Enabled Features**: the list's **Audience & Access**, **Posting Permission**, and **Visibility**. Hover over an item for a short explanation.
- **Subscribers**: the people on the list. See [Manage Subscribers](../manage-subscribers/).

## Edit a list

You need permission to manage the list. Everyone who can open a list's page sees **Edit Mailing List** and **Manage Groups**, but the edit form only opens for people who can manage the list.

1. Open the list's page and select **Edit Mailing List**.
2. The form opens with the list's current details in the same three steps as [Create a Mailing List](../create-mailing-list/). Move between steps with **Next** and **Previous**, or select a step.
3. Change the description, the settings, or the linked group. The list's name can't be changed.
4. On the last step, select **Save Changes**. You see "Mailing list updated successfully" and return to the list's page.

Use **Back to Mailing List** at the top of the form to leave without saving.

## Switch project context

Mailing lists are scoped to a project or foundation. Use the project picker in the sidebar to change it and the page updates.

## Related

- [Create a Mailing List](../create-mailing-list/)
- [Mailing List Settings and Visibility](../mailing-list-settings/)
- [Manage Subscribers](../manage-subscribers/)
- [Mailing Lists overview](../)
- [Mailing Lists FAQ](../faq/)
