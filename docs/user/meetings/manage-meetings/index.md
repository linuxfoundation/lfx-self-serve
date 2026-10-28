---
title: Manage Meetings
description: How to edit, update, and cancel project meetings in LFX Self Serve.
product_area: Meetings
tags: [meetings, manage, edit, cancel]
last_updated: 2026-10-06
intercom_collection: Meetings
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** personas, or anyone granted **Meeting Coordinator** access for the project. Use this guide to update or cancel existing meetings.

## View meetings

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Switch to your **Project** or **Foundation** lens using the lens switcher, then select **Meetings** from the left navigation. Your personal **Meetings** view (Me lens) also shows meetings across your projects, and Edit/Delete still appear there for meetings you organize — that view just doesn't have a **Create Meeting** button.
3. The dashboard lists meetings for your active project context, with **Upcoming** and **Past** tabs. If no meetings are scheduled, the Upcoming tab shows "No meetings yet / Schedule a meeting to get started."
4. Each meeting you organize shows **Edit** and **Delete** icon buttons directly on its card in the list. You can also select a meeting to open its full detail view.

## Edit a meeting

Select the edit (pencil) icon on a meeting you organize, or open the meeting's detail view and choose to edit it. Editing is only available for upcoming meetings. You can update the title, date, time, agenda, recurrence pattern, and platform/feature settings.

For a meeting that's part of a recurring series, selecting edit first asks what to change:

- **Only this occurrence** — opens an **Edit Occurrence** dialog where you can change the date, start time, duration, title, and agenda for that one instance. The time is read in the series' own timezone, and the rest of the series keeps its schedule and details. An agenda that already has text can be changed but not cleared. The recurrence pattern and settings can't be changed per occurrence.
- **The entire series** — opens the full editor, and your changes apply to every upcoming occurrence in the series.

If you have the new meeting editor (currently in preview for some users), the choice is **A single occurrence** or **The entire series**. A single occurrence comes with a picker listing every upcoming occurrence, opened on the one you clicked. Both open the meeting editor drawer, and a note under its title says which you're editing. A single-occurrence edit shows what can change per occurrence — title, date, start time, duration, and agenda — plus its guests. Guests invited to every occurrence are labelled **All occurrences** and are read-only there; anyone you add is invited to that occurrence only (labelled **This occurrence**) and can be removed again. Changes there never affect the rest of the series. Documents, links, and series guests are managed by editing the entire series. Each section notes which series settings it leaves out, with a link to edit the entire series instead. **Save changes** stays disabled until you change something.

## Edit or cancel one occurrence from the join page

On the join page of a recurring meeting you organize, the header shows **Edit this occurrence** and **Cancel this occurrence** buttons next to **Copy meeting link**. They act on the occurrence the page is currently showing — use the occurrence navigation to pick a different one first. After an edit, the page moves to the occurrence at its new time; after a cancel, it moves to the next upcoming occurrence. These buttons don't appear for past occurrences.

## Manage guests and registrants

Organizers control who is invited from the **Invite guests** step of the meeting editor, or from **Invite people** and **View all** on a meeting card. You can add people one at a time or link a group, resend invitations, remove guests, and mark a guest as a **Meeting Host**. For a **Restricted** meeting, the guest list is exactly who can get past the registrant check on the join page. See [Manage Participants](../manage-participants/) for the full steps.

## Manage meeting materials

Organizers add files and links from the **Agenda & resources** section of the meeting editor, or later with **Edit materials** on a meeting card and **Manage** on the join page. On a recurring meeting, materials can apply to one occurrence or to every occurrence. See [Meeting Materials](../meeting-materials/) for the full steps, file limits, and who can see them.

## Delete a meeting

Select the delete (trash) icon on a meeting you organize.

- For a one-time meeting, you'll confirm with **Delete Meeting** — the meeting is permanently deleted; this can't be undone.
- For a meeting that's part of a recurring series, you'll be asked to choose between **Cancel This Occurrence** (only that instance is cancelled; the rest of the series continues) or **Delete Entire Series** (the whole recurring series is permanently deleted). When cancelling one occurrence, you can add an optional **Reason**; it's included in the cancellation email sent to guests.
- With the new meeting editor (preview), the choice is **Cancel a single occurrence** (selected by default, with a picker for which upcoming occurrence) or **Delete the entire series**.

## Subscribe to a calendar feed

There's no button to download a single meeting as an ICS file. Instead, from the Meetings dashboard in your Foundation or Project lens, select **Subscribe** to get a live calendar feed (ICS URL) for that project's or foundation's meetings. The feed excludes **Private** meetings; **Restricted**-but-public meetings still appear on it. Add it once to Google Calendar, Outlook, or Apple Calendar to keep it in sync automatically.

## Share the meeting join link

Each meeting has a unique join URL at `/meetings/:id`. Use the **Copy meeting link** button on the meeting's join page or card, or copy it from the meeting detail view, and share it with attendees. No LFX account is ever required to access a meeting's join page — for a **Private** meeting, the copied link automatically carries the meeting's password.

## Switch project context

Meetings are scoped to a project (or foundation). Use the lens switcher to change your active context. The meetings list updates automatically.

## Related

- [Meeting Materials](../meeting-materials/) — add and organize files and links
- [Manage Participants](../manage-participants/) — invite guests, add groups, resend invitations, and remove people
- [Host Controls and the Host Key](../host-controls/) — find the Zoom host key and make a guest a meeting host
- [Schedule a Meeting](../schedule-meeting/) — create a new meeting
- [Join a Meeting](../join-meeting/) — how attendees access the join page
