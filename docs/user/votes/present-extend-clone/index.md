---
title: Present, Extend, Clone, and Send a Summary
description: How to present a vote on screen, extend its deadline, send the results summary, and clone a vote in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Votes
tags: [votes, present, extend, clone, summary, qr-code, deadline]
last_updated: 2026-10-29
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

The presenter shows the vote's title and description, a live count of how many people have voted out of how many are eligible, and when the vote closes. It does not show how the votes are splitting. Tallies stay hidden until the vote ends.

On the right it shows a **Copy link** button and a QR code with the text **In the room? Scan instead**, so people can open the vote on their phones. The page refreshes itself, and a line at the bottom shows how long ago it last updated. If the connection drops, it keeps trying to reconnect.

### Close the vote early

While the vote is open, **Close vote** at the bottom of the presenter ends it now instead of at its deadline. LFX asks **Close the vote now? Members can no longer cast or change ballots.** Select **Close vote** to confirm, or **Cancel** to keep it open. Pressing **Esc** while this question is showing cancels it; it doesn't leave the presenter.

After you confirm, the presenter switches to the final results within a few seconds. The vote keeps its original deadline on record and also shows when it was closed. If the vote can't be closed (for example it hasn't started yet), LFX shows the reason and the vote stays open. You need permission to manage the vote.

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

**Send summary** emails the results to everyone who was invited to vote. It is available only on ended votes.

1. Select **⋮ → Send summary** on an ended vote.
2. Confirm. The message warns that sending can't be undone.

LFX shows how many voters received the summary, and how many failed if any did. If you try to send before the vote has closed, LFX says the vote hasn't closed yet. The summary is sent only when you ask for it. It is never sent automatically.

## Clone a vote

**Clone** starts a new vote from an existing one, so you don't have to retype the questions. It is available from the menu of active and ended votes, to people with project or foundation access to manage votes, and to people who can edit a group's votes from its **Votes** tab. Ranked-choice and secret-ballot votes can't be cloned yet. See [Create a vote from an existing one](../create-vote/#create-a-vote-from-an-existing-one) for what is copied.

## Delete a draft

Drafts have no **⋮** menu. Select **Delete** on the draft's row and confirm. Deleting can't be undone. See [Manage Votes](../manage-votes/#edit-or-delete-a-draft).

## Related

- [Manage Votes](../manage-votes/)
- [Vote results](../vote-results/)
- [Create a Vote](../create-vote/)
