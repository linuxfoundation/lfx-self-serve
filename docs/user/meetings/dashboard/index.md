---
title: Meetings Dashboard and Filters
description: How to find meetings, filter by your RSVP, and subscribe to a project's meeting calendar in LFX Self Serve.
audience: [all]
product_area: Meetings
tags: [meetings, dashboard, filters, rsvp, calendar, subscribe, upcoming, past]
last_updated: 2026-10-28
intercom_collection: Meetings
---

The **Meetings** page is where you see the meetings you're invited to, organize, or follow. This article explains what's on it, how to filter it, and how to add a project's meetings to your calendar.

## Open the dashboard

Select **Meetings** from the left navigation. What you see depends on your lens:

- **Me lens** (your personal view): meetings across all of your projects. There's no way to create a meeting here. If no upcoming meetings are listed, you'll see "No upcoming meetings — Meetings from your committees and projects will appear here."
- **Foundation or Project lens**: the foundation's or project's meetings. This is where **Create Meeting** appears, if you have write access. If none are scheduled, you'll see "No meetings yet — Schedule a meeting to get started."
- **Org lens**: a meeting analytics view for the organization. It has no **Create Meeting** button.

The Me, Foundation, and Project lenses share the same dashboard, scoped differently.

## Upcoming and Past

Two tabs control when the meeting happens. **Upcoming** is selected by default. **Past** shows your meeting history, including meetings organized by other people. To open a past meeting's details, see [Past Meetings](../past-meetings/).

The tiles at the top of the page summarize the tab you're on:

- **Me lens, Upcoming**: **Meetings in the Next 7 Days**, which counts each upcoming date, including dates you declined, and **Needs response**. Selecting **Needs response** opens the response queue and clears other filters, so they can't hide a meeting that needs your answer.
- **Me lens, Past**: **Past This Month** and **Recordings Available** from the past 30 days.
- **Foundation or Project lens**: **Upcoming Meetings**, **Recurring Series**, **Past Meetings**, and **Recordings Available** from the past 30 days.

## List and Calendar views

In the Foundation or Project lens, you can switch between **List** and **Calendar**. The calendar opens on a month grid, with a **Week** view you can switch to, and you can select a meeting to open it. In the list, select **Load More** to see more meetings.

Two buttons also help you share a project's meetings:

- **Public Calendar** opens the project's public meeting calendar. It's read-only and anyone can use it, so it's a good link to share.
- **Subscribe** adds the meetings to your own calendar. See [Subscribe to a calendar](#subscribe-to-a-calendar).

## Search and filter

Use the controls above the list to narrow it:

- **Search meetings...** finds meetings by name.
- **Select Type** limits the list to one meeting type.
- In the Me lens, you can also filter by foundation or project.
- **Reset filters** clears every filter you've set, without changing the **Upcoming** or **Past** tab.

Your search and meeting type stay selected when you switch between **Upcoming** and **Past**. Your foundation or project, response, and organizer choices reset when you switch.

## Filter by your response

In the Me lens, response filters sit below the **Upcoming** and **Past** tabs:

- **All meetings**: every upcoming meeting in your list, including ones you declined and ones that don't collect RSVPs.
- **Needs response**: meetings that collect RSVPs where you haven't answered for the current or next date. For a recurring meeting, an answer for a different date doesn't count. A meeting where you aren't registered is left out, because you can't respond until you are.
- **Going**, **Maybe**, and **Not going**: meetings where your response for the current or next date matches.

Each filter shows how many upcoming meetings it holds, in parentheses, only when the number is greater than zero. The counts describe all your upcoming meetings, before any search or other filter is applied.

If your response for a meeting isn't available yet, the meeting still shows under **All meetings**, but it's left out of the response filters until your response is known. It's not treated as unanswered.

### Organized by me

The **Organized by me** checkbox shows only meetings you own, and it combines with any response filter. When a meeting has no recorded owner, its creator is treated as the owner. Having access to manage a meeting isn't enough to count as organizing it.

### Hide declined meetings

Declining doesn't remove a meeting from **All meetings**. To hide meetings you declined for every date, select **Hide meetings declined for all dates**. Declining a single date doesn't hide the whole series, and meetings you organize always stay visible. **Not going** always shows declined meetings, whatever this option is set to.

## Meeting cards

Each meeting appears as a card with its date, time, and details.

- **Respond.** When a meeting collects RSVPs, the card shows **Yes**, **Maybe**, and **No** controls. For a recurring meeting, you choose whether your answer applies to **This date only**, **All dates**, or **This date and all following dates**. See [Join a Meeting](../join-meeting/).
- **Materials.** The card lists the meeting's files and links. Organizers see **Edit materials**. See [Meeting Materials](../meeting-materials/).
- **People Invited.** Organizers see the RSVP summary and up to five faces, with **View all** to open the full guest list and **Invite people** to add someone. See [Manage Participants](../manage-participants/).
- **Host Key.** Organizers see a **Host Key** button shortly before the meeting. See [Host Controls and the Host Key](../host-controls/).

## Subscribe to a calendar

There's no button to download a single meeting as an ICS file. To keep a project's or foundation's meetings in your calendar app, subscribe to its live feed instead:

1. In your Foundation or Project lens, open **Meetings** and select **Subscribe**.
2. In the **Subscribe** window, copy the **Calendar Feed URL**, or choose **Google Calendar**, **Outlook.com**, **Outlook 365 / Office**, or **Apple Calendar** to add it directly.

Subscribing keeps your calendar up to date when meetings are added or changed. The feed leaves out **Private** meetings. **Restricted** meetings that are otherwise public still appear on it.

## Related

- [Meetings overview](../) — an overview of the Meetings section
- [Schedule a Meeting](../schedule-meeting/) — create a new meeting
- [Manage Meetings](../manage-meetings/) — edit, cancel, or delete meetings
- [Join a Meeting](../join-meeting/) — RSVP, register, and join
- [Past Meetings](../past-meetings/) — attendance, recording, and summary
