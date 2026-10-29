---
title: Manage Surveys
description: How to find surveys, read the survey list, and understand statuses and reminders in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Surveys
tags: [surveys, manage, status, filters, open, closed, scheduled]
last_updated: 2026-10-28
intercom_collection: Surveys
---

This article is for people who manage surveys for a project or foundation. It explains the **Surveys** page: how to find a survey, what each column and status means, and what you can do with a survey after it is sent.

## Open the Surveys page

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Use the lens switcher and project picker in the sidebar to choose the project or foundation.
3. Select **Surveys** in the sidebar.

The page lists the surveys for the project you have selected. Surveys are scoped to a project, so changing the project changes the list. If a project has no surveys yet, you see "No surveys yet", with a **Create Survey** button if you have permission. See [Create a Survey](../create-survey/).

If you want to see the surveys you personally were invited to answer, switch to your own view (**Me**) instead. See [Respond to a Survey](../respond-to-a-survey/).

## Find a survey

- **Tabs.** **All**, **Open**, and **Closed**. Each tab shows how many surveys it holds, and the counts follow your other filters. Draft and scheduled surveys appear under **All**.
- **Search.** Type in **Search surveys…** to match survey names.
- **All Groups.** Show surveys sent to one group.
- **All Types.** Show surveys of one type, such as **NPS Survey**.

If nothing matches, you see "No results found". Select **Reset filters** to clear everything.

The list shows 10 surveys per page. When you have more, you can switch to 25 or 50 per page. Open surveys come first, then drafts, then scheduled surveys, then closed surveys. Within each group, the soonest due date is first.

## Read the survey list

| Column          | What it shows                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| **Survey Name** | The survey's name. Select it to open its results.                                                              |
| **Survey Type** | For example **NPS Survey**.                                                                                    |
| **Group**       | The group the survey was sent to.                                                                              |
| **Responses**   | How many people responded. Hover over the number to see "X of Y responses" and the percentage.                 |
| **Due**         | The cutoff date, with a countdown such as "Closes in 5 days", "Closes tomorrow", or "Closes today" while open. |
| **Status**      | **Open**, **Closed**, **Scheduled**, or **Draft**.                                                             |

## Statuses

- **Draft**: the survey has been started but not sent. It has no due date.
- **Scheduled**: the survey is set to go out on a future date. Hover over the status to see when. Nobody has received it yet.
- **Open**: the survey has been sent and is accepting responses.
- **Closed**: the cutoff date has passed. A survey closes by itself on its cutoff date, and responses stop being accepted.

## Work with a survey

- **See results.** Select the survey name, or select **Results** on an open or closed survey. See [View Survey Results](../survey-results/).
- **Send reminders.** Reminders are set when you create the survey. Choose **Automatic** reminders (every 3, 7, or 14 days) to nudge people who haven't responded until the survey closes. See [Create a Survey](../create-survey/).
- **Find people who haven't responded.** In the **Responses** tab of the results, filter **Delivery Status**. See [View Survey Results](../survey-results/).

A survey can't be changed or closed early once it has been sent. If you need a different audience, email, or dates, create a new survey. See [Create a Survey](../create-survey/).

### Controls that don't work yet

A few controls appear in the app but don't take effect yet. You may see them, but don't rely on them:

- **Close Survey** and **Duplicate Survey** in the menu at the top of the results panel
- **Save as Draft** in the create form
- **Delete** on a **Draft** row

### Don't use Edit on a draft

**Edit** on a **Draft** row does more than nothing. It opens the create form with default values, not your saved draft. If you fill it in and select **Save Changes**, a new survey is sent straight away, with no confirmation dialog. To change a draft, don't use **Edit**. Create a new survey instead.

## Switch project context

Surveys are scoped to a project. Use the lens switcher and project picker to change the project, and the list updates automatically.

## Related

- [Create a Survey](../create-survey/): send a new survey
- [View Survey Results](../survey-results/): participation, NPS, and individual responses
- [Respond to a Survey](../respond-to-a-survey/): what recipients see
- [Surveys overview](../)
- [Surveys FAQ](../faq/)
