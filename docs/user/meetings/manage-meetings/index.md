---
title: Manage Meetings
description: How to edit, cancel, and delete project meetings in LFX Self Serve.
audience: [all]
product_area: Meetings
tags: [meetings, manage, edit, cancel, delete, recurring, occurrence]
last_updated: 2026-10-28
intercom_collection: Meetings
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** personas, or anyone granted **Meeting Coordinator** access for the project. Use this guide to update, cancel, or delete meetings that already exist. To create one, see [Schedule a Meeting](../schedule-meeting/).

## Find the meeting

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Meetings** from the left navigation, in your **Project** or **Foundation** lens. Your personal **Meetings** view also shows meetings across your projects, and the edit and delete buttons still appear there for meetings you organize.
3. On the **Upcoming** tab, find the meeting. Each meeting you organize shows **Edit** and **Delete** icon buttons on its card. You can also open a meeting's page and manage it from there.

## Edit a meeting

Select the edit (pencil) icon on a meeting you organize. The **Edit meeting** drawer opens with the same sections you used to create it. You can change the title, type, visibility, date and time, recurrence, features, guests, agenda, and materials. See [Schedule a Meeting](../schedule-meeting/) for what each section does.

- **Save changes** stays disabled until you change something.
- You can only edit upcoming meetings. A meeting that has already run is a past meeting. See [Past Meetings](../past-meetings/).
- If you see "You don't have permission to edit this meeting," ask an organizer to grant you access. The meeting is still there, but your access to change it isn't.

### Edit a recurring meeting

For a meeting that's part of a series, selecting edit first asks "This is a recurring meeting. What would you like to edit?" Choose one and select **Continue**:

- **A single occurrence**: change one date only. Pick the date from the **Occurrence** list, which opens on the one you selected.
- **The entire series**: edit the title, schedule, guests, and settings for every upcoming occurrence.

Both open the **Edit meeting** drawer. A note under its title says which one you're editing.

**When you edit a single occurrence**, you can change its title, date, start time, duration, and agenda. Times are read in the series' own timezone. Changes there never affect the rest of the series.

- **Guests** invited to every occurrence are labelled **All occurrences** and can't be removed there. Anyone you add is invited to that occurrence only (labelled **This occurrence**) and you can remove them again. See [Manage Participants](../manage-participants/).
- **Documents and links** aren't part of a single-occurrence edit. Use **Edit materials** on the meeting's card instead. See [Meeting Materials](../meeting-materials/).
- **Everything else**, including the recurrence pattern and features, belongs to the whole series. Each section notes which settings it leaves out and links to editing the entire series.

**When you edit the entire series**, the drawer says "You're editing the entire series. Changes apply to every upcoming occurrence."

### Edit or cancel one occurrence from the join page

On the join page of a recurring meeting you organize, the header shows **Edit this occurrence** and **Cancel this occurrence** buttons next to **Copy meeting link**. They act on the occurrence the page is currently showing, so use the occurrence navigation to pick a different one first. After an edit, the page moves to the occurrence at its new time. After a cancel, it moves to the next upcoming occurrence. These buttons don't appear for past occurrences.

## Cancel or delete a meeting

Select the delete (trash) icon on a meeting you organize.

- **A one-time meeting**: you confirm with **Delete Meeting**. The meeting is permanently deleted and this can't be undone.
- **A recurring meeting**: you're asked "This is a recurring meeting. What would you like to delete?" Choose one and select **Continue**:
  - **Cancel a single occurrence** (selected by default): pick the upcoming occurrence from the **Occurrence** list. The rest of the series continues.
  - **Delete the entire series**: every occurrence is permanently deleted.

### Cancel one occurrence

Before an occurrence is cancelled, you see its **Occurrence Details** (title, date, time, and series). You can add an optional **Reason**, which is included in the cancellation email sent to guests. Cancelling permanently cancels that occurrence, notifies guests, and can't be undone.

## Share the meeting join link

Each meeting has a unique join URL at `/meetings/:id`. Use **Copy meeting link** on the meeting's join page or card, and share it with attendees. For a **Private** meeting, the copied link automatically carries the meeting's password. See [Join a Meeting](../join-meeting/) for what attendees see.

## Subscribe to a calendar feed

There's no button to download a single meeting as an ICS file. Instead, from the Meetings dashboard in your Foundation or Project lens, select **Subscribe** to get a live calendar feed (ICS URL) for that project's or foundation's meetings. The feed excludes **Private** meetings, and **Restricted** meetings that are otherwise public still appear on it. Add it once to Google Calendar, Outlook, or Apple Calendar to keep it in sync automatically.

## Related

- [Schedule a Meeting](../schedule-meeting/) — create a new meeting and choose its settings
- [Manage Participants](../manage-participants/) — invite guests, add groups, resend invitations, and remove people
- [Meeting Materials](../meeting-materials/) — add and organize files and links
- [Host Controls and the Host Key](../host-controls/) — find the Zoom host key and make a guest a meeting host
- [Past Meetings](../past-meetings/) — attendance, recording, and summary after a meeting runs
- [Join a Meeting](../join-meeting/) — how attendees access the join page
