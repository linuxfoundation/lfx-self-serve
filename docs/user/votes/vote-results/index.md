---
title: Vote Results
description: How to see live and final results, abstentions, ranked questions, comments, and voters for a vote in LFX Self Serve.
audience: [all]
product_area: Votes
tags: [votes, results, abstain, comments, ranked, condorcet, tallies, voters]
last_updated: 2026-11-24
intercom_collection: Votes
---

This article explains the vote's page, which shows how a vote is going and how it turned out. What you see depends on whether you manage the vote or are invited to vote on it.

## Open a vote's page

- On the **Votes** dashboard, select **View** on an active vote you manage, or **Results** on an ended vote. Selecting the vote's name does the same.
- In the **Me** lens list, select an ended vote. On an active vote, **Vote** and **Review** open the ballot drawer on the list instead.
- A shared link to a vote (`/votes/:id`) opens its page. If you are invited and still have a ballot to cast, the cast drawer opens on top of it.

The page header shows the vote's title, status and whether ballots are named or pseudo-anonymous. Select **Votes** at the top to go back to the list.

Managers and invited voters also see a **Vote details** card beside the tab content (below it on narrow screens). It lists:

- **Created**, when the vote was created.
- **Group**, the group the vote belongs to.
- **Voting method**, for example **Plurality vote**.
- **Close date**, when the vote closes or closed. Hover or focus it to see the full time zone name; screen readers announce the full time zone too.
- **Time remaining**, on an active vote, for example **Closes in 4 days**.
- **Ended early**, on a vote that was closed before its deadline, with the early-close date.
- **Voters**, how many voters were invited, when that number is known.
- **Vote questions**, how many questions voters answer on the ballot.
- **Comments**, which reads **Active** when the vote collects written comments, and **Comment prompts**, how many comment questions it asks. **Comments** reflects whether comments are turned on, not whether the vote is still open, so it still reads **Active** after the vote closes. Both rows are hidden when the vote has no comment questions.

Web links in the vote's description are blue and underlined, including plain-text addresses starting with `http://` or `https://`. Selecting one opens it in a new tab, leaving the vote's page open. Supported HTML formatting and links are preserved; descriptions mixing unsupported placeholders and HTML use the [literal fallback](../create-vote/#description-formatting). The same applies in the ballot drawer and on a personalized ballot link; your current ballot choices stay in place. Email and phone links keep their usual behavior.

If a vote closed early, **Closed** in **Vote details** uses the recorded early-close time rather than the scheduled deadline, and an **Ended early** row gives the early-close date. If no early-close time is recorded, **Close date** uses the scheduled deadline. That notice does not mean every invited voter responded; use the participation figures to check how many did.

The vote's description keeps its paragraphs, line breaks, and lists, the same as in the cast drawer.

## If you manage the vote

The page opens on the **Overview** tab and has these tabs:

- **Overview** shows the vote's description, a results card with recent comments. For a vote with one question (not ranked), the card shows a bar for each option with its vote count and percentage. The bars follow the order of the options on the ballot, not the vote counts, and keep that order as figures refresh. For a ranked vote or a vote with several questions, it shows a short summary line per question instead. For a ranked question, that line names the option with the most first choices until the vote ends and its final results load; then it names the outcome: **… won**, **Tied: …**, **Elected: …** (Meek STV) or **No winner could be determined**. Condorcet IRV uses **Winner:**, **Tied:** or **No winner** for its final outcome. All these layouts include an **Abstain** row, after the options, when abstaining is allowed or anyone abstained. While a manager views an active vote in a visible browser tab, results refresh about every five seconds after each request finishes; returning to the tab refreshes them immediately. Once the vote closes and its results are successfully refreshed, the winning option is marked **Winner**, or tied options are marked **Tied**. Select **View full results** to open the Results tab. When recent comments appear under **What voters are saying**, a single comment question appears once below the heading and above the comments. With multiple comment questions, each previewed comment shows the question it answers. On a named vote, you can open a voter's ballot by selecting the commenter's name or the comment row outside its text. The comment text stays selectable for copying.
- **Results** shows each question's tallies. The **Overview** tab's status tag reads **Voting in progress** while the vote is active and **Final results** after a successful results refresh following closure. While that final read is pending, the tag reads **Totals pending**. For each non-ranked question, every option shows its count and share of the votes, listed in ballot order rather than by vote count. A vote with several questions lists each question separately as **Q1**, **Q2**, and so on. **Abstain**, when the vote allowed abstaining or anyone abstained, comes after the options and shows how many people abstained. Abstentions count as ballots cast but not in any option's tally.
- **Comments** appears when the vote has comment questions. With a single comment question, its heading, comment count, and comments appear directly—there is no accordion. With two or more questions, each has a collapsible panel showing its full question text and comment count. Panels start collapsed so you can see every question immediately. Select a question's header to show or hide its comments. Panels open independently. An expanded panel lists all comments returned by the results service, without page controls. Up to 200 comments are returned per question; if there are more, a notice tells you how many are displayed out of the total. Your panel choices stay in place when switching tabs or refreshing results within the same vote, and reset when you open another vote. On a named vote, managers also see who wrote each comment and when, with **View ballot** links. The tab shows a count of the comments once results load. On a pseudo-anonymous vote the count stays hidden until comments are released after the vote closes.
- **Voters** appears for active and ended votes, and lists each invited voter with their status. On a named vote it also shows their choices, in the columns **Voter**, **Choice**, **Role** and **Submitted**, and you can open a voter's ballot. On a pseudo-anonymous vote it shows only who has responded, never how anyone voted. The tab shows a count of the invited voters.

A tab shows no count when there is nothing to count.

To send a reminder from the vote's page, use **Send reminder** in the page header. There is no separate reminder button in the **Voters** tab.

The header shows the ballot privacy badge (for example, **Named ballot**); hover over it or focus it with the keyboard to read who can see what. The **Vote details** card lists when the vote was created and whether comments are enabled.

Summary cards below the tab strip show participation:

- **Responded** shows how many invited people have responded, with a progress bar that shows abstentions as a separate segment. While results are held, the bar shows overall participation without an abstention breakdown. Select the card to open the **Voters** tab.
- **Comments** shows how many written comments voters have left. This is a different count from **Responded**, because not every voter writes a comment. Select the card to open the **Comments** tab.
- **Not voted yet** shows how many people haven't voted. Its **View voters** button opens the **Voters** tab. Once everyone has voted it says **Everyone has voted**. If there are no eligible voters, it says **No eligible voters**. On an ended vote, the card is called **Did not vote**. The card itself does not send reminders; use **Send reminder** in the page header.

Active-vote refreshes also check the vote's current status, so a vote ended elsewhere is marked closed without reloading the page. Final-result labels wait for a successful, non-held results refresh after closure. After closure, managers' visible tabs continue reading results while totals are held or a temporary connection or server failure prevents the final read. These reads stop once final results arrive or after 12 completed attempts; temporary failures use a longer retry delay. Returning to the tab does not reset that limit. If results are still unavailable, reload the page to try again.

During background recovery, a temporary connection or server failure keeps the last successful figures visible with **Results may be out of date. Reconnecting automatically.** The notice clears after a successful refresh. After closure, retained figures stay provisional: they have no **Winner** or **Tied** labels, and the status reads **Totals pending** until final results are successfully refreshed. A held response hides totals, abstentions and comments, including any previous figures. If access is denied, results have never loaded successfully, or the final-read retry limit is reached with an error, no old figures are shown.

The buttons at the top right depend on the vote's status:

- **Send reminder** on active votes. See [Send a reminder](../manage-votes/#send-a-reminder).
- **Send ballots now** on active votes. It emails each member who hasn't voted a personal ballot link that doesn't need a login. LFX asks you to confirm how many members will receive it, and the button stays disabled for a couple of minutes afterwards so voters aren't emailed twice. On the vote page a **Ballots sent** message confirms how many members were emailed. When everyone has already voted, the button is disabled and says **Everyone has voted**. If LFX can't load the list of members who haven't voted, it says so and you can try again.
- **Present** and **Copy slide** on active and ended votes. See [Present, Extend, Clone, and Send a Summary](../present-extend-clone/).
- **Cast vote**, if you are also invited and haven't voted yet.

### Ranked questions

Some votes rank their options instead of counting one choice. On an Instant Runoff or Meek STV vote, every option is listed by name, and the Results tab explains the voting method at the top.

Each option shows how many voters ranked it and how many placed it at each rank (**Rank 1**, **Rank 2**, and so on), with a percentage. If no one has ranked yet, it says **No rankings recorded yet.**

The outcome is hidden while voting is open. After the vote ends and its final results load, each ranked question starts with it:

- A banner names the winner, says the options are tied, or says **No winner could be determined.** Instant runoff explains that the winner had a majority of continuing ballots in the final round. Meek STV names the options elected using proportional counting.
- **Standings** list every option in finishing order (**1st**, **2nd**, and so on). The winner is marked **Winner**, or **Tied** when several share first place. Instant-runoff standings show the round each option was knocked out (**Eliminated in round 2**). Meek STV standings show **Elected in round 3**, or **Not elected**.
- The per-rank breakdown follows under **Rank distribution**.

Managers, invited voters who can see the final results, and the **Present** view all show the outcome. Round-by-round vote counts aren't shown yet.

### Condorcet IRV results

A Condorcet IRV vote shows its own results for each question. The winner comes from the voting service; it is not simply the candidate with the most first choices.

- **Final result** puts the outcome first. A prominent card names the winning option and explains whether it beat every other option head-to-head or won through instant-runoff elimination. The method appears as a **Condorcet IRV** or **Instant-runoff fallback** badge. A tie names the tied options and says no single winner can be determined. If no winner could be determined, it says so.
- **Final standings** lists every option in order, with the winner marked **Winner** and tied winners marked **Tied**. When head-to-head wins decided the result, each option shows how many head-to-head matchups it won. When instant-runoff elimination decided it, remaining non-winning options follow the winner in final-round vote-count order, with equal counts ordered by their head-to-head comparison. Eliminated options follow, showing the round they were eliminated in, latest first. When instant-runoff elimination ran but no winner could be determined, the remaining options all share first place.
- **Head-to-head results** compares every pair of options. Read across a row: the first number counts voters preferring that row's option, and the second counts voters preferring the column's option. Text, icons and shading distinguish wins, losses and ties. A closed Condorcet winner also has a short list of its available matchups above the table. On a narrow screen, scroll the table sideways; keyboard users can Tab to a table and use the arrow keys to scroll it, including the exact-rank-count and ballot-ranking tables when expanded; the option names stay in view, with long names wrapping inside their column.
- **How voters ranked each option** shows a stacked preference bar and the exact count for each rank (**1st**, **2nd**, and so on). Each bar is based on ballots that ranked that option, not all invited voters or responses; ballots omitting the option and abstentions are excluded. These distributions are not the final result, and the option with the most first choices need not win. Select **View exact rank counts** to open the accompanying table. Its counts are not links to individual ballots.
- **Ballot breakdown** comes last and starts collapsed when ranking orders are available. Select **View ballot rankings** to see the five most common orders and how many ballots used each. If there are more than five orders, select **Show all rankings** to see the full list, or **Show 5 most common** to return to the preview. Omitted preferences are marked **Not ranked**. Only managers of a named vote see this breakdown. On a pseudo-anonymous vote, or for voters, it says **Ballot-by-ballot rankings aren't available for this vote.** Managers of a named vote can still view individual ballots on the **Voters** tab.

Before a draft opens, the card says **Not open yet** and **Voting has not opened yet. Results will be available once voting begins.** While the vote is active, it says **Voting in progress** and **The vote is currently in progress. Final results will be available once voting has ended.** After voting ends, until the final totals load, it says **Finalizing results** and **Voting has ended. The final outcome will appear once the final totals are confirmed.** None of these states declares a winner or shows final standings. The head-to-head results, preference distributions and available ballot breakdown show the counts so far. While a manager views the Results tab in a visible browser tab, named ballot rankings refresh independently about every five seconds after each read finishes, even at 100% participation or when revised rankings leave participation unchanged. Reads do not overlap, and hidden tabs, leaving Results, or losing access cancel them. Returning to Results reads again.

After voting ends and final totals arrive, **Ballot rankings are being confirmed.** appears during a 12-attempt refresh window. Successful reads do not end the window early, because ballot data can arrive later than totals. Returning to a hidden browser tab does not reset the limit. If ballot counts or ranks still differ at the end, **Ballot rankings may be out of date. They do not match the final totals.** appears. Leave and reopen Results or reload to try again.

Temporary connection or server failures retry with increasing delays, up to 30 seconds. Previously loaded rankings for the same eligible vote remain visible, including after switching away from Results and returning, with **Ballot rankings may be out of date. The latest refresh failed.** Success clears that failure notice. If ballots have never loaded, the unavailable note appears instead. Access errors stop automatic retries.

### Pseudo-anonymous votes

Totals, abstentions and comments stay hidden until the vote closes, and the page says **Totals appear when voting closes**. Once it closes, it may say **Totals are being finalized** until the results are ready. Managers' visible tabs retry within the limit described above; reload the page if totals do not appear. You can still follow who has responded on the **Voters** tab. Comments appear without names for everyone.

## If you are invited to vote

Voters see only their own response while the vote is open. Totals and comments appear after it closes.

| Your situation                    | What the page shows                                                                                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You haven't voted, vote is active | **Results available after voting closes**, a note that you haven't responded yet, and a **Cast vote** button.                                                                                                                                                                       |
| You voted, vote is active         | **Your vote has been recorded** (or **Your responses to N questions have been recorded**) and your recorded ballot. This page has no ballot-changing controls. To edit your own ballot when allowed, go to **Me → Votes → Review** and select **Update Vote** after making changes. |
| The vote has closed               | The final results for each question, abstentions, and comments without names. On a named vote, a note says **Your vote is included in these results.** If no one voted, it says **No votes were submitted.**                                                                        |
| You aren't on the voter list      | **You're not a voter on this vote**. Only invited voters can cast a ballot, and results are shared with voters after the vote closes.                                                                                                                                               |
| You were removed from the vote    | **You don't have access to this vote**.                                                                                                                                                                                                                                             |

If the final results don't load, the page says **Couldn't load results. Try reloading this page.**

## Related

- [Manage Votes](../manage-votes/)
- [Present, Extend, Clone, and Send a Summary](../present-extend-clone/)
- [Votes FAQ](../faq/)
