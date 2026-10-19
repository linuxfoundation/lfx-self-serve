---
title: Manage Votes
description: How to view, update, and close polls in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Votes
tags: [votes, manage, polls, results, reminders]
last_updated: 2026-10-16
intercom_collection: Votes
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** personas. Use this guide to view, update, and manage polls in your project.

## View polls

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Votes** from the left navigation sidebar.
3. The votes dashboard lists all polls for your active project context.
4. Select a poll to open its detail view.

## Cast your vote

1. Open an active poll from the votes dashboard.
2. Select your preferred option or options from the poll.
3. Submit your vote.

## View results

Select a poll to view its current results and status.

## Send a reminder

Remind eligible voters who haven't voted yet on an active poll. Only users who can manage the poll, such as project or group writers, see this option.

1. Open the votes dashboard, or the **Votes** tab of a group.
2. Find an active poll and select the **More** (⋮) menu on its row.
3. Select **Send reminder**. A dialog lists every eligible voter who hasn't voted yet, with all of them selected.
4. Clear the voters you don't want to remind, or use the header checkbox to select or clear everyone.
5. Select **Send**. Each selected voter receives the poll email again.

If everyone has voted, the dialog says so and there is no one to remind. If the poll has closed, it explains that reminders can no longer be sent.

The voter list is checked again before sending. If a selected voter is no longer eligible, no reminders are sent for that batch. Reload the voter list and choose recipients again. A voter who submits while reminders are being queued may still receive one.

If the access or voter-list checks fail before sending starts, the dialog confirms that no reminders were sent and asks you to try again.

While sending, the dialog's close button, Escape, and Cancel are disabled. If the connection is lost or the request times out, the outcome may be unconfirmed: reminders might already have been queued. Retrying may send duplicate emails.

## Edit a poll

1. Open the poll you want to update.
2. Select the edit option on the poll detail page.
3. Update the poll details and save your changes.

## Close a poll

Use the poll settings to edit details or close the poll before its end date.

## Switch project context

Polls are scoped to a project or foundation. Use the lens switcher to change your active context.

## Related

- [Create a Vote](../create-vote/) — steps to create a new poll
- [Votes overview](../) — an overview of the Votes section
