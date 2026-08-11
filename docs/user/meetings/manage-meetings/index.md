---
title: Manage Meetings
description: How to edit, update, and cancel project meetings in LFX Self Serve.
product_area: Meetings
tags: [meetings, manage, edit, cancel]
last_generated: 2026-05-22
last_updated: 2026-08-10
intercom_collection: Meetings
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** personas, or anyone granted **Meeting Coordinator** access for the project. Use this guide to update or cancel existing meetings.

## View meetings

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Switch to your **Project** or **Foundation** lens using the lens switcher, then select **Meetings** from the left navigation. Your personal **My Meetings** view (Me lens) also shows meetings across your projects, and Edit/Delete still appear there for meetings you organize — that view just doesn't have a **Create Meeting** button.
3. The dashboard lists meetings for your active project context, with **Upcoming** and **Past** tabs. If no meetings are scheduled, the Upcoming tab shows "No meetings yet / Schedule a meeting to get started."
4. Each meeting you organize shows **Edit** and **Delete** icon buttons directly on its card in the list. You can also select a meeting to open its full detail view.

## Edit a meeting

Select the edit (pencil) icon on a meeting you organize, or open the meeting's detail view and choose to edit it. Editing is only available for upcoming meetings. You can update the title, date, time, agenda, recurrence pattern, and platform/feature settings.

For a meeting that's part of a recurring series, an edit currently applies only to that single occurrence — there's no option to apply it to the whole series or to future occurrences. This is separate from the delete/cancel scope below, which does let you act on the whole series.

## Manage guests and registrants

The **Invite Guests** step (in the create/edit meeting form) is where you control who's invited — and for a **Restricted** meeting, this list is exactly what determines who can get past the registrant check on the join page. There are two ways to add people:

- **Direct add** — search for a person and add them as an individual guest.
- **Committee-based** — link a project committee to the meeting, then filter its members by voting status before adding them as registrants. Everyone added this way is still tracked as an individual registrant.

The invitation list shows a running count split as "X from committees" and "Y direct guests."

## Manage meeting materials

On the meeting's join page, organizers see a **Manage** button on the Meeting Materials panel (available before the meeting, and after it if you're viewing via the past-meeting link). Use it to upload files (**Primary Materials**) or add links (**Supporting Materials**) for attendees. Materials you add require the viewer to be signed in — this applies to any meeting, not just Private ones.

## Delete a meeting

Select the delete (trash) icon on a meeting you organize.

- For a one-time meeting, you'll confirm with **Delete Meeting** — the meeting is permanently deleted; this can't be undone.
- For a meeting that's part of a recurring series, you'll be asked to choose between **Cancel This Occurrence** (only that instance is cancelled; the rest of the series continues) or **Delete Entire Series** (the whole recurring series is permanently deleted).

## Subscribe to a calendar feed

There's no button to download a single meeting as an ICS file. Instead, from the Meetings dashboard in your Foundation or Project lens, select **Subscribe** to get a live calendar feed (ICS URL) for that project's or foundation's meetings. The feed excludes **Private** meetings; **Restricted**-but-public meetings still appear on it. Add it once to Google Calendar, Outlook, or Apple Calendar to keep it in sync automatically.

## Share the meeting join link

Each meeting has a unique join URL at `/meetings/:id`. Use the **Copy meeting link** button on the meeting's join page or card, or copy it from the meeting detail view, and share it with attendees. No LFX account is ever required to access a meeting's join page — for a **Private** meeting, the copied link automatically carries the meeting's password.

## Switch project context

Meetings are scoped to a project (or foundation). Use the lens switcher to change your active context. The meetings list updates automatically.

## Related

- [Schedule a Meeting](../schedule-meeting/) — create a new meeting
- [Join a Meeting](../join-meeting/) — how attendees access the join page
