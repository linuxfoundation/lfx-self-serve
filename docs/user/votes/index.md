---
title: Votes
description: Create polls, cast votes, and view results for project governance decisions in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Votes
tags: [votes, polls, governance, decisions, elections]
last_updated: 2026-10-28
intercom_collection: Votes
---

All authenticated users can view votes and cast a ballot on the ones they are eligible for. Creating and managing votes requires a **maintainer**, **board-member**, or **executive-director** persona.

The Votes section lets you create and manage votes for formal project governance decisions. Votes are used for committee elections, policy approvals, and other decisions that require a recorded community response.

## What you can do

- View all votes for your project or foundation
- [Create a vote](create-vote/) with one or more questions, comment questions, and an optional abstain choice
- Cast your vote on an open vote: select **Vote**, or **Review** once you have voted
- [See results](vote-results/): **Results** opens a drawer with the tallies, abstentions, and comments
- [Manage votes](manage-votes/): edit or delete drafts, send reminders, and copy a link from the **⋮** row menu
- [Present, extend, clone, or send a summary](present-extend-clone/) from the same row menu

## Navigation

To view and cast votes, select **Votes** from the left navigation sidebar in the **Me** lens (route: `/votes`) — this lists the votes you're eligible for across your projects and foundations. Votes opens on the **Active** tab; select **All** or **Ended** to see your other votes.

To manage votes for a specific context, switch to your **Project** or **Foundation** lens using the lens switcher, then select **Votes** from the left navigation sidebar. The votes dashboard (route: `/project/votes` or `/foundation/votes`) lists the votes for your active project or foundation context and opens on the **Active** tab. Use the tabs to filter: **All**, **Active**, **Draft**, **Ended**. Select **All** to see votes with every status.

In the Project and Foundation lenses, selecting the current status tab again keeps your current page, unless a closing-soon shortcut is selected. Selecting a different status returns to the first page and loads matching polls.

### Project and Foundation summaries

Two summary cells appear above the status tabs:

- **Votes Closing in the Next 7 Days** counts active votes with a deadline strictly after now and within the next seven 24-hour periods. Draft and ended votes do not count.
- **Active Votes** counts all indexed-active votes you can access in the selected context, not only those you were invited to. An overdue or invalid deadline does not remove an otherwise active vote from this total.

Active status is matched without regard to letter case in both summaries and their matching lists, including legacy votes with inconsistent status casing. These votes retain the same actions as other active votes.

Both counts respect **Group**, cover every matching vote rather than only the visible page, and ignore search, status tabs, and pagination. A Foundation summary uses that foundation's selected context; it does not combine descendant projects.

Select **Votes Closing in the Next 7 Days** to switch to **Active** and show only closing-soon votes. Select it again to clear only the shortcut and keep **Active** selected. Select **Active Votes** to clear closing-only mode and show active votes from page one, even if Active was already selected. Search, Group, and rows per page are preserved. Selecting any status tab clears closing-only mode; **Reset filters** clears it and the table filters and selects **All**. Empty filtered lists retain the controls and Reset action.

While the summary loads, counts show dashes and the cells are disabled. A successful empty scope shows zero. A failed summary shows unavailable counts and **Unable to load vote summary** with **Retry**; the list remains usable, and Retry reloads only the summary.

While a replacement list or its total is loading, pagination is hidden so the previous mode's count is not presented as current. Search, Group, and status controls remain available. Pagination returns once the matching rows and total are available.

Changing context or Group, refreshing the list, or returning after creating/editing a vote reloads the totals. Closing selection also refreshes the summary. Totals and list pages use separate time snapshots and may differ near a deadline; they do not update continuously while idle. Changes may take time to appear in the search index. Votes and existing creation, voting, and result permissions are unchanged.

### Empty lists

When a list has no votes, the message names the situation:

- With only a status tab selected, the message names that status — for example **No active votes**, **No draft votes**, or **No ended votes yet**. On **Active**, select **All** to see votes with other statuses.
- When a search, Group, foundation or project filter, or a summary shortcut is also applied, **No votes match your filters** appears instead. It does not mean that no votes exist with the selected status.
- On **All** with no other filters, **No votes yet** appears. In the Project and Foundation lenses, only users who can create votes are offered **Create Vote**; other users are told that votes for the project or foundation will appear there.

Search ignores leading and trailing spaces, so a search of only spaces does not filter the list. **Reset filters** clears every filter and selects **All**.

If **Votes** returns an incomplete list and no returned votes match your view, **Some votes could not be loaded** appears instead of an empty-status or no-match message. Select **Retry** to reload without changing your status tab or filters. Any returned votes that match your view remain usable.

### Sharing a link to a vote

Select **⋮ → Copy link** on an active or ended vote to copy a direct link to it, which you can paste into an email, a chat or a mailing list. Draft votes have no link.

Opening the link signs you in if needed and opens the vote in **Votes**: you can cast your vote if you're invited and haven't voted yet, and otherwise you see the vote. Project and group managers see the same view they get from the Votes dashboard. People who don't have access to the vote see **Page not found**.

### Your vote

In **Votes**, the **Your vote** column shows your participation rather than a response count. A solid green circle-check means **Voted**; hover over or focus the icon to see its tooltip. A muted dash means **Not voted**. Both indicators have accessible labels and apply to active and ended votes. The separate **Status** column shows whether the vote is active or ended. Project, Foundation, and group vote tables retain their response summaries.

### Votes summary

Two summary cells above the table help you find approaching deadlines and outstanding responses:

- **Votes Closing in the Next 7 Days** counts active votes with a deadline after the current time and within seven days, including votes you have already responded to. **Next** shows the nearest matching deadline.
- **Need Your Vote** counts active votes explicitly awaiting your response, regardless of their deadline. **Earliest deadline** shows the earliest valid deadline among those votes. An overdue vote still marked active can appear here.

Counts describe the returned personal feed within your selected foundation, project, and group, not just the visible page. Search, status tabs, and summary selection do not change these totals. Dates use your local timezone; the time snapshot refreshes when votes load successfully or you select a summary cell, not continuously while the page is idle.

Select a cell to filter the table and switch to **Active**. Select the same cell again to clear only the summary filter, leaving **Active** selected; select the other cell to switch filters. Search, group, foundation, project, and rows per page are preserved, and the table returns to its first page. Selecting any status tab, including **Active** again, clears the summary filter.

If your filters have no matches, the empty list keeps the controls available. **Reset filters** clears the summary and table filters and selects **All**. If a scope change removes the selected group, only that group selection is cleared.

Votes group choices use consistent English alphabetical ordering across browser and server locales.

While loading, the cells show dashes and cannot be selected. A successfully loaded empty feed shows zero. If loading fails, counts are unavailable and **Unable to load your votes** appears instead of the no-invitations message. Select **Retry** to reload without losing your search and group controls.

## Key concepts

- **Vote**: A formal decision with one or more questions and an eligible voter set
- **Eligible Participants**: Who in the vote's group can vote: voting reps only, voting reps and alternates, or all members of the group
- **Vote result**: The tally of responses. Voters see it after the vote closes; managers can see live tallies while it is open

## Project context

Votes are scoped to a specific project or foundation. Use the lens switcher to change your active context and see votes for a different project.

## Related sections

- [Committees](../committees/) — committee members are often the eligible voter set for polls
- [Surveys](../surveys/) — for collecting general feedback rather than formal decisions
