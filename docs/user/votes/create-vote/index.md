---
title: Create a Vote
description: How to create a vote in LFX Self Serve with the three-step form, including questions, comment questions, abstain, drafts, and cloning.
audience: [maintainer, board-member, executive-director]
product_area: Votes
tags: [votes, create, questions, abstain, draft, governance, elections]
last_updated: 2026-10-28
intercom_collection: Votes
---

This article is for people who manage votes for a project, foundation, or group. It walks through the **Create Vote** form, which has three steps: **Basic Information**, **Question & Options**, and **Review and Open Vote**.

## Before you begin

- Select the correct project or foundation in the lens switcher. A new vote belongs to the context you have selected.
- You need permission to manage votes for that context. If you don't see **Create Vote**, contact your project administrator.
- Decide which group the vote is for. The group decides who can vote.

## Start a vote

You can start from two places:

- **Votes dashboard:** switch to your **Project** or **Foundation** lens, select **Votes** in the left navigation, then select **Create Vote** at the top of the page.
- **A group's Votes tab:** open the group, select its **Votes** tab, and select **Create Vote**. The group is filled in and locked, and a note at the top says the vote will be created for that group.

The form's **Previous**, **Cancel**, **Save as Draft**, and **Next** buttons stay at the top of the page. On the last step, **Next** becomes **Open Vote**.

## Step 1: Basic Information

| Field                     | What to enter                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vote Title**            | Required. At least three characters.                                                                                                                                       |
| **Description**           | Optional context shown to voters.                                                                                                                                          |
| **Group**                 | Required. The group whose members can vote. Locked when you start from a group's Votes tab.                                                                                |
| **Eligible Participants** | Required. Choose **Voting Reps Only**, **Voting Reps and Alternates**, or **All Members of the Group**.                                                                    |
| **Close Date**            | Required. The day the vote closes, in the timezone you pick below.                                                                                                         |
| **Close Time**            | Required. For example, `11:59 PM`.                                                                                                                                         |
| **Timezone**              | Required. The close date and time must be in the future. A time that doesn't exist in that timezone because of a daylight saving change is rejected, so pick another time. |
| **Allow Abstain**         | **Yes** lets voters abstain instead of choosing an option. **No** (the default) means voters must choose.                                                                  |

Select **Next** when the required fields are filled in.

## Step 2: Question & Options

Each question has:

- **Question:** required, at least 10 characters.
- **Response Type:** **Single selection (radio buttons)** lets each voter pick one option. **Multiple selection (checkboxes)** lets voters pick several.
- **Options:** every question needs at least two. Select **Add Option** for more, and the **✕** next to an option removes it once a question has more than two. Every option must have text.

To ask more than one question in the same vote, select **Add Another Question**. Questions are numbered, and once there is more than one you can remove any of them with the trash icon.

### Comment questions

Below the questions, **Comment Questions** let you ask voters an open-ended question, such as "Why did you vote this way?" Voters answer them in an optional **Additional Comments** section of the ballot.

- Select **Add Comment Question** to add one. You can add up to 50.
- Each comment question is required to have text and can be up to 500 characters. A counter under the box shows how much you have used.
- Select the trash icon to remove one.

## Step 3: Review and Open Vote

The review step summarizes the vote's details, questions, and comment questions. Select **Edit** on a card to jump back to that step and change it.

When everything looks right, select **Open Vote**. A confirmation asks whether to open it now, and warns that once opened, notifications are sent and voting begins immediately. Select **Yes, open vote** to continue, or **Cancel** to go back.

If the close time passes while you are on the form, you see a **Deadline expired** message and LFX takes you back to step 1 to pick a new deadline.

## Save a draft instead

Select **Save as Draft** on any step to save your work without opening the vote. A draft needs only a **Vote Title** and a **Group**, and any comment questions you added must not be blank. Drafts are not visible to voters, and no notifications are sent.

Drafts appear under the **Draft** tab on the Votes dashboard. See [Manage Votes](../manage-votes/) to edit, open, or delete a draft.

## Create a vote from an existing one

To reuse a vote's questions and settings, select **⋮ → Clone** on its row. This opens the **Create Vote** form prefilled:

- The title starts with **Copy of**.
- The questions, options, comment questions, eligible participants, and **Allow Abstain** setting are copied.
- If the original deadline is still in the future it is kept. Otherwise the close date is set seven days from today at `11:59 PM` in your timezone.

Ranked-choice votes and secret-ballot votes can't be cloned yet. LFX shows **Cannot clone** and doesn't open the form.

Review and change anything you like, then open the vote or save it as a draft. **Clone** is covered with the other row actions in [Present, Extend, Clone, and Send a Summary](../present-extend-clone/).

## After you open the vote

The vote appears on the **Votes** dashboard with an **Active** status, and eligible voters can cast their ballots until it closes. You can [send reminders](../manage-votes/#send-a-reminder), [extend the deadline](../present-extend-clone/#extend-the-deadline), or [present the vote](../present-extend-clone/#present-a-vote) from its row.

An active vote can't be edited. If you need to change a question or option, check [Manage Votes](../manage-votes/) for what is available.

## Permissions

Only users who can manage votes for the project, foundation, or group can create them. Everyone else can view and vote on the votes they are invited to.

## Related

- [Manage Votes](../manage-votes/): edit drafts, send reminders, and share a link
- [Present, Extend, Clone, and Send a Summary](../present-extend-clone/)
- [Vote results](../vote-results/)
- [Groups](../../committees/): a group's members are the voter set for its votes
