---
title: Manage Surveys
description: How to view, edit, and analyze surveys in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Surveys
tags: [surveys, manage, responses, nps, analytics]
last_updated: 2026-10-27
intercom_collection: Surveys
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** personas. Use this guide to view, edit, and analyze your project surveys.

## View surveys

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Surveys** from the left navigation sidebar.
3. The surveys dashboard lists all surveys for your active project context.
4. Select a survey to open its detail view.

## View survey responses

Select a survey to open its detail view and see response data.

If you have **Manage** access on the project, the detail view also shows:

- **Delivery, open, click and comment rates** next to the response rate on the **Overview** tab. Open and click rates are out of delivered emails; the comment rate is out of responses.
- **Participant comments** on the **Overview** tab.
- A **Responses** tab with every recipient's delivery status, response date, NPS score and comment. Filters and search cover all recipients.

## Follow up with recipients

These actions need **Manage** access on the project. On the **Responses** tab:

- Select **Send reminders** to resend the survey email to recipients who have not responded. Every non-respondent starts selected; clear anyone you don't want to remind. This is available while the survey is open.
- Select **Download CSV** to export every recipient's delivery status, response and comment. The file does not include personal survey links.
- Open the **⋮** menu on a recipient's row to:
  - **Send reminder** — resend the survey email to that recipient (open surveys, non-respondents only).
  - **Copy personal link** — copy the recipient's own survey link. Anyone with this link can answer as that recipient, so share it only with them.
  - **Email recipient** — open your mail app with a reminder that includes their personal link.
  - **View sent email** — see the survey email as that recipient received it, with their name, project and link filled in.

## View NPS analytics

The Net Promoter Score (NPS) analytics show how likely respondents are to recommend your project.

## Resync recipients

If committee members joined after the survey launched, you can send it to them too. This needs **Manage** access on the project and an open survey.

1. Open the survey and select the **⋮** menu in the header.
2. Select **Resync recipients**. The dialog lists the committee members who would receive the survey.
3. Select **Send** to email them.

A resync only adds recipients. Existing recipients are not emailed again and no one is removed. On a survey sent to several foundations' boards, it only covers your project's board.

## Edit a survey

1. Open the survey you want to update.
2. Select the edit option (route: `/surveys/manage` with the existing survey loaded).
3. Update the survey title, questions, or settings.
4. Save your changes.

## Close or deactivate a survey

Select a survey to view its responses and results. Use the survey settings to edit or close it.

## Switch project context

Surveys are scoped to a project. Use the lens switcher to change your active project context. The surveys list updates automatically.

## Related

- [Create a Survey](../create-survey/) — steps to create a new survey
- [Surveys overview](../) — an overview of the Surveys section
