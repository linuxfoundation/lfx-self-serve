---
title: Manage Subscribers
description: How to add subscribers to a mailing list, set their delivery mode and role, edit their details, and remove them in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Mailing Lists
tags: [mailing-lists, subscribers, members, moderator, delivery mode, add, remove]
last_updated: 2026-10-28
intercom_collection: Mailing Lists
---

This article is for people who manage a mailing list. It explains how to see who is subscribed, add people, choose how they receive email, make someone a moderator, and remove people. If you only want to join or leave a list yourself, see [Manage Mailing Lists](../manage-mailing-lists/).

## Open the subscribers

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select the project or foundation, then select **Mailing Lists** in the sidebar.
3. Select the list's name to open its page.

The subscribers are in the table at the bottom of the page. The top of the page shows how many subscribers the list has, for example "42 subscribers".

Members of any group linked to the list are subscribed automatically. See [Manage Mailing Lists](../manage-mailing-lists/) for how to link a group.

## Read the subscriber table

The table has these columns:

- **Name**
- **Title**
- **Organization**
- **Email**: select an address to write to the person
- **Delivery Mode**: **Individual**, **Digest**, or **None**
- **Role**: **Member** or **Moderator**
- **Actions**: edit and remove

The table shows 10 subscribers per page, and you can switch to 25 or 50. It is sorted by email address. If nothing matches, you see "No subscribers found".

### Search and filter

- **Search members…**: matches names, email addresses, organizations, and titles as you type
- **Filter by Delivery Mode**: **All Delivery Modes**, **Individual**, **Digest**, or **None**
- **Filter by Role**: **All Roles**, **Member**, or **Moderator**

## Add a subscriber

1. Select **Add Subscriber**.
2. Fill in the form:
   - **First Name** (required)
   - **Last Name** (required)
   - **Title**
   - **Organization**
   - **Email** (required, and it must be a valid address)
   - **Delivery Mode**: choose how the person receives email (see below)
   - **Role**: **Member** or **Moderator**
3. Select **Add Subscriber**, or **Cancel** to close the form without saving.

You see "First name is required", "Last name is required", "Email is required", or "Please enter a valid email address" when a required field is missing. After the subscriber is added you see "Subscriber added successfully". If the address is already on the list, you see "<the address> is already subscribed to this mailing list." Any other failure shows "Failed to add subscriber".

### Delivery mode

- **Individual**: the person receives messages as they are posted.
- **Digest**: the person receives messages grouped together.
- **None**: the person is subscribed but receives no list email.

### Role

- **Member**: a regular subscriber.
- **Moderator**: can post to **Announcement** lists, where only moderators can post. See [Mailing List Settings and Visibility](../mailing-list-settings/).

## Change a delivery mode or role

Select the **Delivery Mode** or **Role** in a subscriber's row and choose a new value from the list. It saves straight away, and you see "Delivery mode updated" or "Role updated". If it doesn't save, you see "Failed to update delivery mode" or "Failed to update role".

## Edit a subscriber's details

1. Select the edit (pencil) icon in the subscriber's row.
2. Change the **Title** or **Organization**.
3. Select **Update Member**. You see "Subscriber updated successfully".

The subscriber's name and email address can't be changed after they are added. The form says so: "Name and email cannot be changed after member is added." To fix a wrong email or name, remove the subscriber and add them again.

## Remove a subscriber

1. Select the trash icon in the subscriber's row.
2. In the **Remove Subscriber** dialog, read "Are you sure you want to remove" followed by the person and the list. They will no longer receive emails from the list.
3. Select **Remove Subscriber**, or **Cancel** to keep them.

You see "Subscriber removed successfully". If it fails, you see "Failed to remove subscriber".

## Related

- [Mailing List Settings and Visibility](../mailing-list-settings/): Announcement lists and moderators
- [Create a Mailing List](../create-mailing-list/)
- [Manage Mailing Lists](../manage-mailing-lists/): join, leave, and edit lists
- [Mailing Lists FAQ](../faq/)
