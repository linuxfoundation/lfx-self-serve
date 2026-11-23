---
title: Present, Extend, Clone, and Send a Summary
description: How to present a vote on screen, extend its deadline, send the results summary, and clone a vote in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Votes
tags: [votes, present, extend, clone, summary, qr-code, deadline]
last_updated: 2026-11-03
intercom_collection: Votes
---

This article is for people who manage votes. These actions are in the **⋮** (**More actions**) menu on a vote's row on the **Votes** dashboard. See [Manage Votes](../manage-votes/) for the full list of row actions.

## Present a vote

**Present** opens a full-screen view designed to be shown in a meeting. Use it to show people how many have voted, give them a way to join, and reveal the results once the vote closes.

1. Find an active or ended vote you manage.
2. Select **⋮ → Present**. The presenter opens in a new browser tab at `/votes/:id/present`.

You can also open it from the **Present** button on the vote's [page](../vote-results/).

You need permission to manage the vote. If you don't have it, **Present** isn't in the menu.

### While the vote is open

The presenter shows the vote's title and description (with its paragraphs, line breaks, and lists kept; a long description scrolls inside its own area), a live count of how many people have voted out of how many are eligible, and when the vote closes. It does not show how the votes are splitting. Tallies stay hidden until the vote ends.

Descriptions follow the same [formatting rules](../create-vote/#description-formatting) as the ballot and vote page, including a literal fallback for mixed unsupported placeholders and HTML.

On the right it shows a **Copy link** button and a QR code with the text **In the room? Scan instead**, so people can open the vote on their phones. The page refreshes itself, and a line at the bottom shows how long ago it last updated. If the connection drops, it keeps trying to reconnect.

### Close the vote early

While the vote is open, **Close vote** at the bottom of the presenter ends it now instead of at its deadline. LFX asks **Close the vote now? Members can no longer cast or change ballots.** Select **Close vote** to confirm, or **Cancel** to keep it open. Pressing **Esc** while this question is showing cancels it; it doesn't leave the presenter.

After you confirm, the presenter switches to the final results within a few seconds. The vote keeps its original deadline on record and also shows when it was closed. If the vote can't be closed (for example it hasn't started yet), LFX shows the reason and the vote stays open. You need permission to manage the vote.

You can also close an open vote from the votes list: select **⋮ → Close vote** on its row. It asks the same question. After you confirm, the row shows as ended and a **Vote closed** message appears; if the vote can't be closed, LFX shows the reason and the row stays as it was.

### Leave the presenter

While the vote is open, **Exit** (or **Esc**) asks **Leave the presenter? The vote stays open.** Select **Leave** to go to the vote's page, or **Stay** to keep presenting. Pressing **Esc** or clicking outside the question also keeps you on the presenter. The same goes for the questions from **Close vote** and **Send ballots now**: **Esc** only dismisses the question. If you dismiss the question, focus goes back to the button you used. After you close the vote, focus moves to **Exit**.

### After the vote ends

The same page switches to the final results: the tally for each question, abstentions when the vote allowed them, turnout (how many cast a vote out of those eligible, and how many didn't), and when the vote closed.

If results are still being finalized, the presenter keeps tallies, abstentions, and turnout hidden and checks again for a limited time. A failed check during that wait does not interrupt the finalizing message or stop the remaining checks. If results are still unavailable after the automatic checks stop, exit and reopen the presenter to try again.

Press **Exit** or **Esc** to leave the presenter. Once the vote has ended it leaves straight away, with no question. It takes you to the vote's page in LFX.

### Copy slide

The page for a vote you manage also has a **Copy slide** button, which copies an image with the vote's title, link, and QR code so you can paste it into Slides or PowerPoint. If your browser can't copy images, LFX saves the image as a file instead.

## Extend the deadline

**Extend** moves an active vote's closing time later.

1. Select **⋮ → Extend** on an active vote.
2. In the **Extend Deadline** dialog, choose a **New Close Date**, **New Close Time**, and **Timezone**. The new deadline must be later than the current one, and a time that doesn't exist in that timezone because of a daylight saving change is rejected.
3. Select **Extend Deadline**.

The row shows the new deadline right away. You can only extend a vote that is still active. Once a vote has ended, create a new one instead, and [clone](#clone-a-vote) the old one to save time.

## Send a summary

**Send summary** emails the results to everyone who was invited to vote. It is available only on ended votes, to people who can manage the vote.

1. Select **⋮ → Send summary** on an ended vote.
2. Review who will receive it. The **Send summary** dialog shows the vote name, how many voters and how many email addresses there are, and two lists:
   - **Ready to receive:** voters with an email address, with their name and address.
   - **No email address:** voters who can't receive the summary because there is no email address on file.
3. Select **Send**. To leave without sending anything, select **Cancel**.
4. Select **Send now** to confirm. Emails can't be recalled once sent. Select **Back** to return to the list instead.

The list is for review only. You can't add or remove voters from it. If several voters share an email address, the dialog says so, and that address receives one summary. If no voter has an email address, the dialog says **Nobody can be emailed** and **Send** stays unavailable. If the vote has no invited voters, the dialog says so. If the list can't load, select **Retry**.

While sending is in progress, the vote's row shows a spinner and **Sending summary…** under its name (on a phone, below the name and status at the top of its card). Select **Hide while sending** to return to the table and use other row actions or send another vote's summary. This hides only the dialog; it does not cancel the send. The **⋮ → Sending summary…** item reopens the pending send, not a second request. Screen readers announce when sending starts and when it finishes; open **Send summary** to inspect the result. The indicator means LFX is still waiting for the request, not that emails have been delivered.

Recipient lists and results show the voter's username when no display name is available. If neither is available, LFX uses the email address, or **—** when there is no address either.

Keyboard users can Tab into each scrollable recipient list and use the arrow or Page Down keys to inspect more rows. Selecting **Send** moves focus to the confirmation question; **Back** and a rejected send return focus to **Send**. Selecting **Send now**, or reopening a pending send, moves focus to **Hide while sending** while the request remains pending. If results are already available, focus moves to the results summary instead. Selecting **Retry** moves focus to **Cancel** while loading, then to **Send** when recipients are ready, **Retry** if loading fails again, or **Cancel** when nobody can be emailed. Screen readers announce recipient loading when the dialog opens and when you retry. Another vote's send finishing does not move focus away from the results you are inspecting.

While the summary is sending, **Cancel**, **Back**, and the header **X** are unavailable; use **Hide while sending** to leave the dialog without cancelling the send. A screen-reader status announces that sending is in progress and that hiding does not cancel it. LFX waits up to five minutes for a response. If that deadline expires, it shows review-based **Unconfirmed** results and allows you to close the dialog; the server may still be sending emails, so this is not a cancellation and LFX does not automatically retry. When detailed results are available, the dialog keeps the vote name visible and shows each voter grouped by outcome:

- **Sent:** the email service confirmed the send. LFX doesn't track whether the email reached the inbox or was opened.
- **Not sent:** the email was not sent.
- **Missing email:** the voter has no email address on file, so nothing could be sent.
- **Unconfirmed:** LFX couldn't confirm the send, for example after a timeout, a lost connection, or an email-service error after sending may have started. The email may already have arrived, so sending again could create duplicates. Check with voters before sending again.

Voters who share an email address share that address's outcome. The results summary and group totals include each voter, including voters who share an address. When LFX receives detailed send results, they reflect the voters at the moment of sending, so they can differ from the list you reviewed if voters changed in between.

If LFX can't obtain detailed send results, for example after a lost connection, timeout, or a response from an older server, the dialog explicitly labels its counts as based on the **earlier review**, not confirmed send outcomes. Voters who had an email address are shown as **Unconfirmed**. Voters who lacked an address appear under **No email at review**, which does not mean they were definitely skipped when sending. The actual send-time recipients and outcomes are unknown: addresses may have changed, and newly added voters may not appear in these lists. Check with voters before sending again, because emails may already have arrived.

If you hide the dialog or navigate elsewhere in LFX while sending, the operation continues. Return to the same vote and select **⋮ → Sending summary…** while it is pending, or **⋮ → Send summary** after it finishes, to inspect that attempt rather than starting another send. Select **Close** or the header **X** on the results to dismiss the retained attempt; reopening after either loads a fresh review. This information is kept only in memory in the current app session, scoped to the user identity known to that tab. Refreshing the page or an identity change observed by the app clears it. Explicit login, logout, and impersonation transitions reload the app; automatic impersonation expiry or a session change in another tab may not immediately update this tab's identity. Restoring retained results does not revalidate the server session; new recipient reviews and send requests still require server-side access checks. Clearing this state does not cancel server-side sending. Check with voters before sending again, including from another tab, because emails may already have arrived. There is no resend action in the results dialog.

If you try to send before the vote has closed, LFX says the vote hasn't closed yet. If pre-send checks find that you need to sign in again or that the vote is no longer available, LFX says that nothing was sent and explains the issue instead of asking you to retry the same send. The summary is sent only when you ask for it. It is never sent automatically.

## Clone a vote

**Clone** starts a new vote from an existing one, so you don't have to retype the questions. It is available from the menu of active and ended votes, to people with project or foundation access to manage votes, and to people who can edit a group's votes from its **Votes** tab. Ranked-choice and secret-ballot votes can't be cloned yet. See [Create a vote from an existing one](../create-vote/#create-a-vote-from-an-existing-one) for what is copied.

## Delete a draft

Drafts have no **⋮** menu. Select **Delete** on the draft's row and confirm. Deleting can't be undone. See [Manage Votes](../manage-votes/#edit-or-delete-a-draft).

## Related

- [Manage Votes](../manage-votes/)
- [Vote results](../vote-results/)
- [Create a Vote](../create-vote/)
