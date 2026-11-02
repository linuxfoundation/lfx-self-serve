---
title: View Survey Results
description: How to see participation, the Net Promoter Score, comments, and individual responses for a survey in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Surveys
tags: [surveys, results, nps, responses, comments, delivery status]
last_updated: 2026-10-28
intercom_collection: Surveys
---

This article is for people who manage surveys for a project or foundation. It explains the **Results** panel, which shows how many people have responded, the Net Promoter Score (NPS), and each person's response.

If you received a survey and want to see your own answer, see [Respond to a Survey](../respond-to-a-survey/).

## Open the results

1. Select the project or foundation you want, then select **Surveys** in the sidebar.
2. Find the survey in the list. Select its name, or select **Results** at the end of the row.

**Results** is offered for **Open** and **Closed** surveys. **Draft** and **Scheduled** surveys have no results yet.

The panel opens on the right. The header shows the survey name, the group it was sent to, its status, and its close date ("Closes" followed by the date while it is open, or "Closed" followed by the date once it has ended). Use the **Overview** tab for totals and the NPS breakdown. If you can manage the survey, there is also a **Responses** tab with one row per recipient.

On the **Surveys** page, the **Responses** tab is available to people with permission to manage surveys for the project. If you are a writer of a group but not of the project, open the survey from the group's **Surveys** tab instead. The results panel there includes **Responses** for you.

## Overview

### Participation

At the top, three numbers and a progress bar show how the survey is going:

- **Total Participants**: everyone the survey was sent to. This counts people. It is not the same figure as **Total Participants** on the review step when you create a survey, which counts the groups you selected.
- **Total Responses**: how many have responded
- **Response Rate**: responses as a percentage of participants

While the survey is open, this section is titled **Live Participation** and shows the results collected so far. The panel doesn't refresh itself. Reload the page and reopen **Results** to see new responses. A note at the bottom reminds you that final results are available after the survey closes. Once the survey closes, the section is titled **Final Results**.

### Net Promoter Score

For NPS surveys, the **Net Promoter Score** gauge shows the score from -100 to +100, with a label:

| Score       | Label             |
| ----------- | ----------------- |
| 50 to 100   | Excellent         |
| 0 to 49     | Good              |
| -50 to -1   | Needs Improvement |
| -100 to -51 | Critical          |

The **Response Breakdown** next to it counts each group of respondents, with the number and percentage of responses:

- **Promoters (9-10)**
- **Passives (7-8)**
- **Detractors (0-6)**
- **No Response**: people who haven't responded yet, shown as a share of participants. This row appears only while some haven't responded.

The NPS is the percentage of promoters minus the percentage of detractors. Passives count toward the total but not toward the score.

### Participant Comments

If anyone left a comment, a **Participant Comments** list appears below, with a count. Scroll the list to read them all. Comments are shown without names here. To see who wrote a comment, use the **Responses** tab.

## Responses

The **Responses** tab lists each recipient and what they did. The heading shows how many have responded out of everyone who was sent the survey, for example "12 / 40 Responses".

Each row shows:

- **Recipient**: name and email address (select the email to write to them)
- **Organization**: their organization and job title
- **Delivery Status**: the latest status of the email, with the time it happened
- **Response Date**: when they responded
- **NPS Score**: the score they gave, colored by promoter, passive, or detractor
- **Comment**: what they wrote

Rows are arranged in sections that you can collapse or expand. Select a column heading to sort by it. The list loads in pages; select **Load more responses** to see more.

### Filter and search

Use the controls above the list to narrow it down:

- **NPS Score**: **All**, **Promoters (9-10)**, **Passives (7-8)**, or **Detractors (0-6)**
- **Comment**: **All**, **With comment**, or **Without comment**
- **Delivery Status**: **All**, **Responded**, **Clicked**, **Opened**, **Delivered**, **Failed**, or **Pending**
- **Search Respondents**: find someone by name, email address, or organization

Filters and search only look at the responses that are already loaded. If the list is long, select **Load more responses** until it is fully loaded before you rely on a filter or a search. Otherwise a person on a later page won't appear, and you may see "No respondents match your filters." even though a match exists.

**Delivery Status** helps you find people who haven't responded yet. **Delivered**, **Opened**, and **Clicked** are stages of the invitation email, and **Responded** means they submitted a response. Check **Failed** and **Pending** rows to find invitations that didn't reach someone, so you can follow up another way.

If nothing matches, you see "No respondents match your filters." If nobody has responded and no filter is set, you see "No responses yet."

## Related

- [Manage Surveys](../manage-surveys/): the Surveys page, tabs, and filters
- [Create a Survey](../create-survey/): set reminders so non-respondents are nudged automatically
- [Respond to a Survey](../respond-to-a-survey/)
- [Surveys FAQ](../faq/)
