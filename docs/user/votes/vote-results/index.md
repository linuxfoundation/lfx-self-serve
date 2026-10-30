---
title: Vote Results
description: How to see live and final results, abstentions, ranked questions, comments, and voters for a vote in LFX Self Serve.
audience: [all]
product_area: Votes
tags: [votes, results, abstain, comments, ranked, tallies, voters]
last_updated: 2026-10-30
intercom_collection: Votes
---

This article explains the vote's page, which shows how a vote is going and how it turned out. What you see depends on whether you manage the vote or are invited to vote on it.

## Open a vote's page

- On the **Votes** dashboard, select **View** on an active vote you manage, or **Results** on an ended vote. Selecting the vote's name does the same.
- In the **Me** lens list, select an ended vote. On an active vote, **Vote** and **Review** open the ballot drawer on the list instead.
- A shared link to a vote (`/votes/:id`) opens its page. If you are invited and still have a ballot to cast, the cast drawer opens on top of it.

The page header shows the vote's title, status, whether ballots are named or pseudo-anonymous, its group, voting method, close date and how many voters were invited. Select **Votes** at the top to go back to the list.

Web links in the vote's description are blue and underlined, including plain-text addresses starting with `http://` or `https://`. Selecting one opens it in a new tab, leaving the vote's page open. Existing rich-text formatting and links are preserved. The same applies in the ballot drawer and on a personalized ballot link; your current ballot choices stay in place. Email and phone links keep their usual behavior.

If a vote closed early, **Closed** in the header uses the recorded early-close time rather than the scheduled deadline, and its notice gives the early-close date. If no early-close time is recorded, the header uses the scheduled deadline. That notice does not mean every invited voter responded; use the participation figures to check how many did.

## If you manage the vote

The page opens on the **Overview** tab and has these tabs:

- **Overview** shows the vote's description, a short results summary with a **View full results** link, and recent comments.
- **Results** shows each question's tallies. The **Overview** tab's status tag reads **Voting in progress** while the vote is active and **Final results** once it has ended. For each question, every option shows its count and share of the votes. A vote with several questions lists each question separately as **Q1**, **Q2**, and so on. **Abstain**, when the vote allowed abstaining or anyone abstained, shows how many people abstained. Abstentions count as ballots cast but not in any option's tally.
- **Comments** appears when the vote has comment questions. It lists each comment question with its responses and the date, paged when the list is long. On a named vote, managers also see who wrote each comment.
- **Voters** appears for active and ended votes, and lists each invited voter with their status. On a named vote it also shows their choices, and you can open a voter's ballot. On a pseudo-anonymous vote it shows only who has responded, never how anyone voted.

Summary cards below the tab strip show how many people have responded and how many comments there are. Select a card to jump to the matching tab, or select the not-voted card to send a reminder.

The buttons at the top right depend on the vote's status:

- **Send reminder** on active votes. See [Send a reminder](../manage-votes/#send-a-reminder).
- **Present** and **Copy slide** on active and ended votes. See [Present, Extend, Clone, and Send a Summary](../present-extend-clone/).
- **Send ballots now** on active votes. It emails each member who hasn't voted a personal ballot link that doesn't need a login. LFX asks you to confirm how many members will receive it, and the button stays disabled for a couple of minutes afterwards so voters aren't emailed twice. When everyone has already voted, the button is disabled and says **Everyone has voted**. If LFX can't load the list of members who haven't voted, it says so and you can try again.
- **Cast vote**, if you are also invited and haven't voted yet.

On an active vote the header also shows how long is left, for example **Closes in 4 days**, next to the closing date. Hover or focus the closing date to see the full time zone name. Screen readers also announce the full time zone with the closing date.

### Ranked questions

Some votes rank their options instead of counting one choice. For those, each option shows how many voters ranked it and how many placed it at each rank (**Rank 1**, **Rank 2**, and so on), with a percentage. The Results tab explains the voting method at the top. Round-by-round detail isn't shown yet. If no one has ranked yet, it says **No rankings recorded yet.**

### Pseudo-anonymous votes

Totals, abstentions and comments stay hidden until the vote closes, and the page says **Totals appear when voting closes**. Once it closes, it may say **Totals are being finalized** until the results are ready. You can still follow who has responded on the **Voters** tab. Comments appear without names for everyone.

## If you are invited to vote

Voters see only their own response while the vote is open. Totals and comments appear after it closes.

| Your situation                    | What the page shows                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You haven't voted, vote is active | **Results available after voting closes**, a note that you haven't responded yet, and a **Cast vote** button.                                                                                                                   |
| You voted, vote is active         | **Your vote has been recorded** (or **Your responses to N questions have been recorded**) and your recorded ballot. The signed-in app offers no way to change it; a personalized ballot link can still update an active ballot. |
| The vote has closed               | The final results for each question, abstentions, and comments without names. On a named vote, a note says **Your vote is included in these results.** If no one voted, it says **No votes were submitted.**                    |
| You aren't on the voter list      | **You're not a voter on this vote**. Only invited voters can cast a ballot, and results are shared with voters after the vote closes.                                                                                           |
| You were removed from the vote    | **You don't have access to this vote**.                                                                                                                                                                                         |

If the final results don't load, the page says **Couldn't load results. Try reloading this page.**

## Related

- [Manage Votes](../manage-votes/)
- [Present, Extend, Clone, and Send a Summary](../present-extend-clone/)
- [Votes FAQ](../faq/)
