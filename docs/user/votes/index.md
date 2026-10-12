---
title: Votes
description: Create polls, cast votes, and view results for project governance decisions in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Votes
tags: [votes, polls, governance, decisions, elections]
last_updated: 2026-10-09
intercom_collection: Votes
---

All authenticated users can view polls and cast votes on polls they are eligible for. Creating and managing polls requires a **maintainer**, **board-member**, or **executive-director** persona.

The Votes section lets you create and manage polls for formal project governance decisions. Votes are used for committee elections, policy approvals, and other decisions that require a recorded community response.

## What you can do

- View all polls for your project or foundation
- Create new polls with custom options and voting rules
- Cast your vote on open polls
- View real-time and final vote results
- Manage poll settings and close polls

## Navigation

To view and cast votes, select **My Votes** from the left navigation sidebar in the **Me** lens (route: `/votes`) — this lists the polls you're eligible for across your projects and foundations.

To manage polls for a specific context, switch to your **Project** or **Foundation** lens using the lens switcher, then select **Votes** from the left navigation sidebar. The votes dashboard (route: `/project/votes` or `/foundation/votes`) lists all polls for your active project or foundation context. Use the tabs to filter: **All**, **Active**, **Draft**, **Ended**.

In the Project and Foundation lenses, selecting the current status tab again keeps your current page. Selecting a different status returns to the first page and loads matching polls.

### My Votes summary

Two summary cells above the table help you find approaching deadlines and outstanding responses:

- **Votes Closing in the Next 7 Days** counts active votes with a deadline after the current time and within seven days, including votes you have already responded to. **Next** shows the nearest matching deadline.
- **Need Your Vote** counts active votes explicitly awaiting your response, regardless of their deadline. **Earliest deadline** shows the earliest valid deadline among those votes. An overdue vote still marked active can appear here.

Counts describe the returned personal feed within your selected foundation, project, and group, not just the visible page. Search, status tabs, and summary selection do not change these totals. Dates use your local timezone; the time snapshot refreshes when votes load successfully or you select a summary cell, not continuously while the page is idle.

Select a cell to filter the table and switch to **Active**. Select the same cell again to clear only the summary filter, leaving **Active** selected; select the other cell to switch filters. Search, group, foundation, project, and rows per page are preserved, and the table returns to its first page. Selecting any status tab, including **Active** again, clears the summary filter.

If your filters have no matches, **No results found** keeps the controls available. **Reset filters** clears the summary and table filters. If a scope change removes the selected group, only that group selection is cleared.

My Votes group choices use consistent English alphabetical ordering across browser and server locales.

While loading, the cells show dashes and cannot be selected. A successfully loaded empty feed shows zero. If loading fails, counts are unavailable and **Unable to load your votes** appears instead of the no-invitations message. Select **Retry** to reload without losing your search and group controls.

## Key concepts

- **Poll**: A formal vote with defined options and an eligible voter set
- **Voter eligibility**: Voter eligibility is configured by the poll creator.
- **Vote result**: The tally of responses after the poll closes

## Project context

Votes are scoped to a specific project or foundation. Use the lens switcher to change your active context and see votes for a different project.

## Related sections

- [Committees](../committees/) — committee members are often the eligible voter set for polls
- [Surveys](../surveys/) — for collecting general feedback rather than formal decisions
