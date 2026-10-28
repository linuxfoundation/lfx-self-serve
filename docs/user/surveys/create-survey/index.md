---
title: Create a Survey
description: How to create and send an NPS survey to the members of one or more groups in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Surveys
tags: [surveys, create, nps, feedback, reminders, email, schedule]
last_updated: 2026-10-28
intercom_collection: Surveys
---

This article is for people who can manage surveys for a project, or who are a writer of the group they want to survey. If you don't see **Create Survey**, you don't have permission to create surveys there. Contact your project administrator.

A survey is an NPS (Net Promoter Score) survey sent by email to the members of the groups you choose. You pick the groups, pick a template, set when the survey goes out and when it closes, and write the email. You don't write the questions yourself. They come from the template.

## Open the survey form

There are two ways in:

- **From the Surveys page.** Switch to the project or foundation you want, select **Surveys** in the sidebar, then select **Create Survey**.
- **From a group.** Open the group, select its **Surveys** tab, then select **Create Survey**. The group is filled in and locked, and a banner reads "This survey will be created for" followed by the group's name. **Cancel** and a successful send both return you to the group's **Surveys** tab.

The **Create Survey** form is a four-step wizard: **Audience & Type**, **Timing & Reminders**, **Email Draft**, and **Review & Confirm**. Select **Next** to move forward and **Previous** to go back. **Next** stays disabled until the current step is complete, so you move through the steps in order. **Cancel** leaves the form without sending anything.

## Step 1: Audience & Type

1. Under **Target Audience**, select the groups to survey. Use the **Search groups…** box to find a group. At least one is required, or you see "Please select at least one group." If you came from a group, that group is already chosen.
2. Under **NPS Survey Template**, open the list that reads **Select Survey** and choose a template. A template is required, or you see "Please select a survey template."

The survey goes to the members of the groups you select. For Board groups, it goes only to voting representatives. The survey is named after the first group you select, for example "Technical Advisory Committee Survey".

## Step 2: Timing & Reminders

**When should the survey be distributed?**

- **Immediate.** The survey is sent as soon as you confirm, within a few minutes.
- **Scheduled.** Pick a **Schedule Date**. It can't be in the past. The email goes out on that date.

**Survey Cutoff Date** is the date the survey closes and stops accepting responses. It is required and must be after the send date.

**How should reminders be sent?**

- **Automatic.** Reminders go to people who haven't responded. Choose **Reminder Frequency**: **Every 3 days**, **Every 7 days** (the default), or **Every 14 days**. Reminders continue until the survey closes.
- **Manual.** No reminders are sent automatically.

## Step 3: Email Draft

The survey is delivered by email. The form opens with a default subject and message that you can change.

- **Subject Line** is required and can be up to 200 characters.
- **Body** is required.
- **Preview Email** shows the message with sample values filled in so you can check how it reads.

The **Custom Variables** panel on the right lists placeholders that are replaced with each person's own details when the email is sent. Select a variable to copy it, then paste it into the subject or body. A **Copied!** note confirms the copy.

| Group            | Variables                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| **Participant**  | `{{FirstName}}`, `{{LastName}}`, `{{EmailAddress}}`                                                       |
| **Organization** | `{{OrganizationName}}`, `{{ProjectName}}`, `{{CommitteeName}}`, `{{CommitteeType}}`, `{{MembershipTier}}` |
| **Survey**       | `{{SurveyTemplate}}`, `{{SurveyLink}}`, `{{SurveyButton}}`, `{{CutoffDate}}`, `{{Quarter}}`, `{{Year}}`   |
| **Sender**       | `{{ExecutiveDirectorName}}`, `{{SenderTitle}}`, `{{SenderEmail}}`                                         |

Keep `{{SurveyButton}}` in the body. It becomes the **Take Survey** button that recipients select to open the survey. `{{SurveyLink}}` inserts the survey link as plain text.

## Step 4: Review & Confirm

The last step summarizes the survey before it is sent:

- **Survey Details**: **Survey Type**, **Target Groups**, and **Total Participants**
- **Distribution & Reminders**: **Distribution**, **Cutoff Date**, and **Reminders**
- **Email Preview**: the subject and body as recipients will see them

Each section has an **Edit** control that jumps back to that step.

When everything looks right, select **Send Survey**. If you chose a scheduled date, the button reads **Schedule Survey** instead. A confirmation dialog summarizes who will receive the survey, when, and how reminders work:

- **Send Survey**: "Are you sure…" with **Yes, send survey** and **Cancel**. Once sent, emails are delivered to all recipients.
- **Schedule Survey**: the same, with **Yes, schedule survey**. Emails are delivered on the scheduled date.

After you confirm, you see "Survey sent successfully" or "Survey scheduled successfully", and you return to the Surveys page. If something goes wrong, you see "Failed to create survey. Please try again." and stay on the form.

## After you send

- The survey appears on the **Surveys** page. Immediate surveys show **Open**. Scheduled surveys show **Scheduled** until the send date.
- Recipients get the email, and the survey shows up on their own **Surveys** page. See [Respond to a Survey](../respond-to-a-survey/).
- Follow responses as they come in. See [View Survey Results](../survey-results/).
- A survey closes on its cutoff date.

## Related

- [Manage Surveys](../manage-surveys/): the Surveys page, tabs, filters, and statuses
- [View Survey Results](../survey-results/): participation, NPS, and individual responses
- [Respond to a Survey](../respond-to-a-survey/): what recipients see
- [Surveys FAQ](../faq/)
- [Votes](../../votes/): for formal decision-making polls rather than feedback surveys
