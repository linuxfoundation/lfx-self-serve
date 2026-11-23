---
title: View Survey Results
description: How to see participation, the Net Promoter Score, comments, and individual responses for a survey in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Surveys
tags: [surveys, results, nps, responses, comments, delivery status]
last_updated: 2026-11-05
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

If you can manage the survey, a second row adds:

- **Delivery Rate**: invitations delivered, out of all participants
- **Open Rate**: delivered invitations that were opened
- **Click Rate**: delivered invitations whose survey link was selected
- **Comment Rate**: responses that include a comment

Each rate shows its count underneath, for example "27 / 34". If these can't be loaded, the panel says so; close and reopen **Results** to try again.

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

If you can manage the survey and anyone left a comment, a **Participant Comments** list appears below, newest first, with a count and the date of each comment. Scroll the list to read them all. Comments are shown without names here. To see who wrote a comment, use the **Responses** tab.

## Responses

The **Responses** tab lists each recipient and what they did. The heading shows how many have responded out of everyone who was sent the survey, for example "12 / 40 Responses".

Each row shows:

- **Recipient**: name and email address (select the email to open a reminder to them in your mail app)
- **Company**: their company and job title
- **Delivery Status**: the latest status of the email, with the time it happened
- **Response Date**: when they responded
- **NPS Score**: the score they gave, colored by promoter, passive, or detractor
- **Comment**: what they wrote

Rows are arranged in sections that you can collapse or expand. Select a column heading to sort by it. The tab loads every recipient, so the list, filters, search and download always cover everyone. If some responses can't be loaded, a message says the list may be incomplete; close and reopen **Results** to try again.

### Filter and search

Use the controls above the list to narrow it down:

- **NPS Score**: **All**, **Promoters (9-10)**, **Passives (7-8)**, or **Detractors (0-6)**
- **Comment**: **All**, **With comment**, or **Without comment**
- **Delivery Status**: **All**, **Responded**, **Clicked**, **Opened**, **Delivered**, **Failed**, or **Pending**
- **Search Respondents**: find someone by name, email address, or company

**Delivery Status** helps you find people who haven't responded yet. **Delivered**, **Opened**, and **Clicked** are stages of the invitation email, and **Responded** means they submitted a response. Check **Failed** and **Pending** rows to find invitations that didn't reach someone, so you can follow up another way.

If nothing matches, you see "No respondents match your filters." If nobody has responded and no filter is set, you see "No responses yet."

### Follow up with recipients

On the **Responses** tab:

- Select **Send reminders** to resend the survey email, with each person's personal link, to recipients in your project's groups who haven't responded. Everyone starts selected; clear anyone you don't want to remind. You can send to at most 1,000 people at a time. This is available while the survey is open, to people who manage the project (a group writer who isn't a project writer doesn't see it).
- Select **Download CSV** to export every recipient's delivery status, response and comment. The file does not include personal survey links.
- Open the **⋮** menu on a recipient's row to:
  - **Send reminder**: resend the survey email to that recipient (open surveys, recipients who haven't responded).
  - **Copy personal link**: copy the recipient's own survey link. Anyone with this link can answer as that recipient, so share it only with them.
  - **Email recipient**: open your mail app with a reminder that includes their personal link.
  - **View sent email**: see the survey email as that recipient received it, with their name, project and link filled in.

Personal links are shown only to people who manage the project the recipient's group belongs to. A group writer who isn't a project writer sees the menu without **Copy personal link**, and the reminder email has no link.

### Resync recipients

If people joined the group after the survey was sent, you can send it to them too. This needs permission to manage the project (not only the group) and an open survey.

1. Open the survey's **Results** and select the **⋮** menu in the header.
2. Select **Resync recipients**. The dialog lists the group members who would receive the survey.
3. Select **Send** to email them.

A resync only adds recipients. People who already have the survey aren't emailed again, and no one is removed. On a survey sent to several foundations' boards, it only covers your project's groups. If part of a resync fails, the dialog tells you how many groups were already sent and lists who is still missing, so you can try again.

## Related

- [Manage Surveys](../manage-surveys/): the Surveys page, tabs, and filters
- [Create a Survey](../create-survey/): set reminders so non-respondents are nudged automatically
- [Respond to a Survey](../respond-to-a-survey/)
- [Surveys FAQ](../faq/)
