---
title: Manage Votes
description: How to view, update, and close polls in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Votes
tags: [votes, manage, polls, results, reminders, mailing-list]
last_updated: 2026-10-28
intercom_collection: Votes
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** personas. Use this guide to view, update, and manage polls in your project.

## View polls

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Votes** from the left navigation sidebar.
3. The votes dashboard opens on the **Active** tab, listing open polls for your active project context. Select **All**, **Draft**, or **Ended** to see polls with other statuses.
4. Select a poll to open its detail view.

## Cast your vote

1. Open an active poll from the votes dashboard.
2. Select your preferred option or options from the poll.
3. Submit your vote.

## View results

Select a poll to view its current results and status.

## Present a poll in a meeting

If you can manage a poll, you can show it on a shared screen while it is active or after it ends.

1. Open the votes dashboard in the **Project** or **Foundation** lens, or the **Votes** tab of a group.
2. Select the **More** (⋮) menu on the poll's row and select **Present**, or open the poll's results and select **Present**. The presenter view opens in a new tab, without the LFX navigation.
3. While the poll is open, the view shows how many voters have cast a ballot, the vote link, and a QR code that people in the room can scan. Choices and tallies are not shown until the poll closes. If LFX doesn't have a count of ballots cast, the view shows **Count unavailable**. If the view loses its connection, a **Reconnecting** badge appears and the last count stays on screen until it reconnects. If no eligible voters are assigned to the poll, the view shows **No eligible voters** instead. After the poll ends, the view shows the result for each option and the turnout.
4. Select **Exit** or press Escape to leave the presenter view and go to the poll's page.

To add the poll to your own slides instead, open the poll's results and select **Copy slide**. LFX copies an image with the poll title, vote link, and QR code so you can paste it into Slides or PowerPoint. If your browser can't copy the image, it downloads it as a file instead.

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

## Send a reminder to the mailing list

Draft a reminder to the poll's group mailing list in your own email app. LFX doesn't send this message: you review it and send it yourself. Only users who can manage the poll see this option, and only on active polls.

1. Find an active poll and select the **More** (⋮) menu on its row.
2. Select **Send reminder to mailing list**. Your email app opens a draft addressed to the group's mailing list. The draft names the poll, its closing date and time, and links to the poll.
3. If the group has several mailing lists, LFX first asks which one to use. Pick a list and select **Open in email**.
4. Review and edit the draft in your email app, then send it.

The message goes to everyone on the list, including people who have already voted or can't vote. If nothing opens, check that your device has a default email app set up.

If the group has no mailing list, LFX tells you so. Use **Copy link** to share the poll another way, or **Send reminder** to email the voters directly.

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
