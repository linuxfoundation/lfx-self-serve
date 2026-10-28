---
title: Reconcile Attendance
description: How organizers match the people in a meeting's Zoom attendance record to real people in LFX Self Serve.
audience: [all]
product_area: Meetings
tags: [meetings, past meetings, attendance, reconcile, participants, organizer, zoom]
last_updated: 2026-10-28
intercom_collection: Meetings
---

Zoom records attendees by the name they joined with, such as "Sam's iPhone" or "Guest 2". **Reconcile Attendance** lets an organizer match those names to the real people who were in the meeting, so the **Participants** table and the attendance totals on a past meeting are accurate.

This is for **organizers** of the meeting. If you don't see the button, you're not an organizer of that meeting.

## Open Reconcile Attendance

1. Sign in to [app.lfx.dev](https://app.lfx.dev) and open **Meetings**.
2. Select the **Past** tab, then select **See Meeting Details** on the meeting.
3. Select **Reconcile Attendance**.

The **Reconcile Attendance** panel opens and starts matching straight away. Matches that are certain are applied automatically when it opens, and the **Participants** table refreshes to show them. You'll see a spinner while it works.

## Which attendees are reviewed

The panel reviews attendees who haven't been checked yet. It leaves out:

- People who are already confirmed or assigned
- People you've marked as **Leave Unknown**
- Recording and notetaker bots, such as Otter.ai or Fireflies.ai notetakers, which aren't people who need to be identified

## How matching works

1. **Exact match.** Each attendee is compared with the people invited to that meeting, the members of any linked group, and people already confirmed at earlier occurrences of the same meeting. If exactly one person matches by email or username, with no conflict, it counts as a high-confidence match and is applied automatically.
2. **Suggestions.** For everyone else, the panel suggests a likely match using AI. **AI suggestions are never applied automatically.** They wait for you to review them.

If a source of candidates couldn't be loaded, a banner says "Some candidate sources failed to load, so no matches were auto-applied this run. Review all results below." In that case, nothing is applied for you and every result needs your review.

## The three tabs

The panel groups results into three tabs. Each tab name shows how many attendees are in it.

- **Needs Review**: a likely match was found, but it isn't certain. Check it and decide.
- **Unmatched**: no good match was found.
- **Auto-matched**: matches that were applied automatically. These are listed so you can check them. No actions are offered here.

Each row shows the attendee's Zoom name, how confident the match is, and how it was found: **deterministic** (an exact email or username match) or **ai**. If there's a suggestion, the row shows it as **Suggested** with the person's name, email, and organization. In **Auto-matched**, it shows **Matched** instead.

## Review a result

### Confirm a suggestion

In **Needs Review**, select **Confirm Match** to accept the suggested person. The attendee is recorded as attended and verified, and leaves the list.

### Assign a person yourself

In **Needs Review** or **Unmatched**, select **Assign** to enter who the attendee is. If there's a suggestion, its details are filled in for you to adjust.

1. Enter the person's **Email**. This is required.
2. Optionally enter their **Username**, **First name**, and **Last name**.
3. Select **Save Assignment**, or **Cancel** to close the form without saving.

If you leave the email blank, you'll see "Enter an email to assign this attendee."

### Leave an attendee unknown

In **Unmatched**, select **Leave Unknown** if you can't tell who the attendee is, or don't need to. This marks the attendee as reviewed without attaching a person. They're left out of future reconciliation runs, so they won't come back every time you open the panel.

## After you reconcile

Each time you confirm, assign, or leave an attendee unknown, the row leaves the list and you see **Attendee Updated**. Close the panel when you're done. The **Participants** table on the details page shows the matched names and emails, and the attendance totals reflect your changes. See [Past Meetings](../past-meetings/).

## Troubleshooting

- **I don't see Reconcile Attendance.** It only appears for organizers of the meeting, on the past meeting's details page, not on the card in the Meetings list.
- **"Failed to run attendance reconciliation. Please try again."** Close the panel and open it again.
- **"Failed to update this attendee. Please try again."** The change wasn't saved and the attendee is still in the list. Try the action again.
- **"No attendees in this tab."** There's nothing to review in that tab.

## Related

- [Past Meetings](../past-meetings/) — the details page, attendance, and participants
- [Manage Participants](../manage-participants/) — control who is invited to a meeting
- [Meetings overview](../) — an overview of the Meetings section
