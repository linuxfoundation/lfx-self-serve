---
title: Manage Votes
description: How to find, edit, delete, vote on, and send reminders for votes in LFX Self Serve.
audience: [all]
product_area: Votes
tags: [votes, manage, drafts, cast, reminders, mailing-list, copy-link]
last_updated: 2026-10-28
intercom_collection: Votes
---

This article is for people who manage votes for a project, foundation, or group, and for anyone who needs to cast a ballot. It covers the actions on each row of the **Votes** dashboard.

## Find a vote

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Switch to your **Project** or **Foundation** lens, then select **Votes** from the left navigation sidebar.
3. The dashboard opens on the **Active** tab. Select **All**, **Draft**, or **Ended** to see votes with other statuses.
4. Use the search box and the group filter to narrow the list.

## What each row offers

The buttons on a row depend on the vote's status and on whether you can manage votes there. On the Project and Foundation dashboards, and on a group's **Votes** tab, people who can manage votes see the buttons below. Anyone else sees **Vote** or **Review** on active votes and **Results** on ended votes, with no buttons on drafts.

| Status     | Buttons on the row   | What they do                                                         |
| ---------- | -------------------- | -------------------------------------------------------------------- |
| **Draft**  | **Edit**, **Delete** | Edit the draft, or delete it. Drafts have no **⋮** menu.             |
| **Active** | **View**             | Opens the [Results drawer](../vote-results/) with live results.      |
| **Ended**  | **Results**          | Opens the [Results drawer](../vote-results/) with the final results. |

Active and ended votes also have a **⋮** (**More actions**) menu. Selecting a row's name opens the same drawer as the main button.

### The ⋮ menu

| Item                              | Who sees it                                                       | When                   |
| --------------------------------- | ----------------------------------------------------------------- | ---------------------- |
| **Copy link**                     | Anyone who can see the row                                        | Active and ended votes |
| **Present**                       | People who can manage the vote                                    | Active and ended votes |
| **Extend**                        | People who can manage the vote                                    | Active votes           |
| **Send reminder**                 | People who can manage the vote                                    | Active votes           |
| **Send reminder to mailing list** | People who can manage the vote                                    | Active votes           |
| **Send summary**                  | People who can manage the vote                                    | Ended votes            |
| **Clone**                         | People who can manage votes for the project, foundation, or group | Active and ended votes |

**Present**, **Extend**, **Send summary**, and **Clone** are covered in [Present, Extend, Clone, and Send a Summary](../present-extend-clone/). Reminders and **Copy link** are below.

## Edit or delete a draft

Only drafts can be edited. An active vote can't be edited, and there is no action to close a vote early. If an active vote has a mistake, [clone it](../present-extend-clone/#clone-a-vote) into a corrected vote.

1. Open the **Draft** tab.
2. Select **Edit** on the draft. The create form opens with your saved answers, and you can jump between steps freely.
3. Change what you need, then select **Save as Draft** to keep it as a draft or **Open Vote** on the last step to open it.

To delete a draft, select **Delete** on its row and confirm. Deleting can't be undone.

See [Create a Vote](../create-vote/) for what each field means.

## Cast your vote

You vote from the **Me** lens, where **Votes** lists the votes you are invited to.

1. Find the active vote. Its button reads **Vote** if you haven't voted yet.
2. Select **Vote**. A drawer opens with the vote's details and questions.
3. Answer each question. Single-selection questions use radio buttons to pick one option. Multiple-selection questions use checkboxes, so select all that apply. For ranked-choice questions, drag the options or use the arrow buttons to put them in your preferred order, with your first choice at the top.
4. If the vote has comment questions, optionally answer them under **Additional Comments (Optional)**. Each comment can be up to 5,000 characters.
5. If the vote allows abstaining, you can select **Abstain from this vote** instead. An abstention is recorded as a non-vote and overrides your choices, though any comments are still submitted.
6. Select **Submit Vote**.

After you submit, the row's button changes to **Review** and your **Your vote** column shows **Voted**. **Review** opens a confirmation that your vote was recorded. You can't change a ballot after submitting it, and results stay hidden until the vote closes.

## Share a link

Select **⋮ → Copy link** to copy a direct link to the vote. See [Sharing a link to a vote](../#sharing-a-link-to-a-vote) for who can open it.

## Send a reminder

Remind eligible voters who haven't voted yet on an active vote. Only users who can manage the vote, such as project or group writers, see this option.

1. Open the votes dashboard, or the **Votes** tab of a group.
2. Find an active vote and select the **More** (⋮) menu on its row.
3. Select **Send reminder**. A dialog lists every eligible voter who hasn't voted yet, with all of them selected.
4. Clear the voters you don't want to remind, or use the header checkbox to select or clear everyone.
5. Select **Send**. Each selected voter receives the vote email again.

If everyone has voted, the dialog says so and there is no one to remind. If the vote has closed, it explains that reminders can no longer be sent.

The voter list is checked again before sending. If a selected voter is no longer eligible, no reminders are sent for that batch. Reload the voter list and choose recipients again. A voter who submits while reminders are being queued may still receive one.

If the access or voter-list checks fail before sending starts, the dialog confirms that no reminders were sent and asks you to try again.

While sending, the dialog's close button, Escape, and Cancel are disabled. If the connection is lost or the request times out, the outcome may be unconfirmed: reminders might already have been queued. Retrying may send duplicate emails.

## Send a reminder to the mailing list

Draft a reminder to the vote's group mailing list in your own email app. LFX doesn't send this message: you review it and send it yourself. Only users who can manage the vote see this option, and only on active votes.

1. Find an active vote and select the **More** (⋮) menu on its row.
2. Select **Send reminder to mailing list**. Your email app opens a draft addressed to the group's mailing list. The draft names the vote, its closing date and time, and links to the vote.
3. If the group has several mailing lists, LFX first asks which one to use. Pick a list and select **Open in email**.
4. Review and edit the draft in your email app, then send it.

The message goes to everyone on the list, including people who have already voted or can't vote. If nothing opens, check that your device has a default email app set up.

If the group has no mailing list, LFX tells you so. Use **Copy link** to share the vote another way, or **Send reminder** to email the voters directly.

## Switch project context

Votes are scoped to a project or foundation. Use the lens switcher to change your active context.

## Related

- [Create a Vote](../create-vote/): steps to create a new vote
- [Present, Extend, Clone, and Send a Summary](../present-extend-clone/)
- [Vote results](../vote-results/)
- [Votes overview](../): an overview of the Votes section
