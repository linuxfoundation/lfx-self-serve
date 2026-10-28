---
title: Create a Mailing List
description: How to create a mailing list for a project or foundation in LFX Self Serve, step by step.
audience: [maintainer, board-member, executive-director]
product_area: Mailing Lists
tags: [mailing-lists, create, wizard, groups-io, settings, groups]
last_updated: 2026-10-28
intercom_collection: Mailing Lists
---

This article is for people who can manage mailing lists for a project or foundation. If you don't see **Add Mailing List**, you don't have permission to create lists there. Contact your project administrator.

Mailing lists in LFX Self Serve run on Groups.io. Creating a list sets up a new email address for the project and lets you choose who can join, who can post, and who can read the archive.

## Before you begin

1. Use the project picker in the sidebar to select the project or foundation the list belongs to. The new list is created for the project you have selected.
2. Make sure the project, or its parent foundation, has a mailing list service. If neither does, there is no **Add Mailing List** button. When the project also has no lists, the **Mailing Lists** page shows "Mailing list service hasn't been set up yet for this project. To create a mailing list for your project, contact support." with a **Contact Support** button. Contact support to have the service set up first.

## Open the form

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select the project or foundation, then select **Mailing Lists** in the sidebar.
3. Select **Add Mailing List**.

The **Add Mailing List** form is a three-step wizard: **Basic Information**, **Mailing List Settings**, and **People & Groups**. Select **Next** to move forward and **Previous** to go back. **Next** stays disabled until the current step is complete, so you move through the steps in order. **Cancel** is available on the first two steps and returns you to the **Mailing Lists** page. You can also use **Back to Mailing Lists** at the top of the form.

## Step 1: Basic Information

The step opens with a line that reads "This mailing list belongs to" followed by your project and the mailing list domain. This tells you which project and domain the new address will be created under.

**Mailing List Name** is required. Use a simple, purpose-based name such as `dev`, `announce`, or `community`. Under the field, **Email address** shows the full address the list will have, so you can check it before you continue.

A name must follow these rules:

- At least 3 characters
- Letters and numbers only, with single hyphens allowed between characters
- No more than 34 characters. When a project prefix applies, the prefix and its hyphen count toward the 34, so the name itself has to be shorter. The **Email address** preview shows the full address, including any prefix, and an error such as "Name cannot exceed N characters (prefix … uses M of 34 allowed)" tells you how much room the name has.

You see an error under the field when a rule isn't met, for example "Mailing list name is required", "Name must be at least 3 characters", or "Name can only contain letters and numbers, with single hyphens allowed between characters". If a list with the same name already exists, you see "A mailing list with this name already exists".

**What is this list used for?** is required. Describe the list in a sentence or two so people know when to use it. The description must be between 11 and 500 characters.

## Step 2: Mailing List Settings

Choose three things: **Audience & Access** (who can join), **Posting Permission** (who can post), and **Visibility** (who can read past messages). The defaults are **Public**, **Open Discussion**, and **Public**, which are the recommended starting point. See [Mailing List Settings and Visibility](../mailing-list-settings/) for what each option does. Two of them need extra care:

- **Subscribers only** visibility can't be changed back to **Public** later.
- An **Announcement** list must have **Public** visibility.

## Step 3: People & Groups

The step title mentions people, but it only lets you link a group. Search for a group and select it to link it to the mailing list. This is optional, and you can link one group while creating the list.

Members of a linked group are automatically subscribed to the list. You can't add individual subscribers or moderators in this step. Add them after the list is created. See [Manage Subscribers](../manage-subscribers/).

## Create the list

On the last step, select **Add Mailing List**. You see "Mailing list created successfully" and return to the **Mailing Lists** page, where the new list appears.

If something goes wrong:

- **Duplicate name.** You return to step 1 with the name flagged. Choose a different name.
- **Address rejected.** You see "Unable to create mailing list" explaining that the generated address was rejected. Try again, and contact support if it keeps happening.
- **Service setup failed.** If the project has no mailing list service of its own, one is set up for it when you create the list. If that step fails, you see "Failed to create mailing list service for this project". Try again, and contact support if it keeps failing.
- **Anything else.** You see "Failed to create mailing list". Try again, and contact support if it keeps failing.

## After you create a list

- The list name can't be changed after it is created. The edit form shows it as read-only with "Mailing list name cannot be changed after creation."
- You can change the description, settings, and linked group at any time. See [Manage Mailing Lists](../manage-mailing-lists/).
- Add subscribers and moderators from the list's page. See [Manage Subscribers](../manage-subscribers/).

## Related

- [Mailing List Settings and Visibility](../mailing-list-settings/): what each setting does
- [Manage Subscribers](../manage-subscribers/): add people and set roles
- [Manage Mailing Lists](../manage-mailing-lists/): find, join, leave, and edit lists
- [Mailing Lists overview](../)
- [Committees](../../committees/): link a group so its members are subscribed automatically
