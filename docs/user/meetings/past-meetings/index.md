---
title: Past Meetings
description: How to find a past meeting, read its attendance, and watch its recording or read its AI summary in LFX Self Serve.
audience: [all]
product_area: Meetings
tags: [meetings, past meetings, attendance, participants, recording, transcript, ai summary]
last_updated: 2026-10-28
intercom_collection: Meetings
---

Once a meeting has run, it moves from the **Upcoming** tab to the **Past** tab and gets a details page. That page shows who attended, and gives access to the recording, transcript, and AI summary if the organizer turned them on. The meeting's materials move onto the past meeting too, where they're managed separately. See [Meeting Materials](../meeting-materials/).

## Find a past meeting

1. Sign in to [app.lfx.dev](https://app.lfx.dev) and open **Meetings**.
2. Select the **Past** tab. It shows your meeting history, including meetings organized by other people.
3. Select **See Meeting Details** on a meeting's card. If you organize the meeting, this opens its details page. Otherwise it opens the meeting's join page, where you find the attendance totals, **Meeting Materials**, and **Meeting Tools**. See [Join a Meeting](../join-meeting/).

On the card, **Recording**, **Transcripts**, and **AI Summary** tags show what exists for the meeting, and an **Attended** label shows if you were there. Select **Back** on the details page to return to the list.

## The meeting details page

Organizers open this page from the **Past** tab. Everyone else is taken to the meeting's join page instead.

The top of the page shows the meeting's title with an **Ended** tag, and tags for **Private** or **Restricted** access, the meeting type, a recurring pattern, and the date and time. **Recording**, **Transcripts**, and **AI Summary** tags show which of those exist for this meeting.

### Attendance

When the meeting has participants, the page summarizes attendance:

- **Rate**: the share of participants who attended, as a percentage
- **Attended**: how many participants attended, out of the total
- **Absent**: how many participants didn't, out of the total

### Actions

- **Watch Recording** opens the recording in a new tab.
- **AI Summary** opens the meeting's AI-generated summary. Organizers also see an **Approved** or **Pending** badge here.
- **Reconcile Attendance** is for organizers. It lets them review how people in the Zoom attendance record were matched to LFX users and correct the matches. See [Reconcile Attendance](../reconcile-attendance/).

The page also shows the meeting's **Agenda** and its **Resources**, which are the files and links attached to the meeting. Organizers always see **Resources**, so they can add to it with **Manage**. Everyone else sees it only when it has something in it.

## Participants

The **Participants** table lists everyone who was invited or attended. For each person, it shows:

- **Name**, with an **Organizer** tag on people listed as the meeting's organizers, and a **Host** tag on guests an organizer marked as a Meeting Host. An organizer is a host already, so they only show **Organizer**. A **Host** tag doesn't mean the person can manage the meeting
- **Email**, **Organization**, and **Title**
- **Voting Status**, when the meeting was linked to a group that uses voting
- **Attendance**: **Attended** or **Absent**
- **Invitation**: **Invited** or **Not invited** (someone who joined without being on the guest list)

Use the filters above the table to narrow the list:

- By invitation: **All**, **Invited**, or **Uninvited**
- By attendance: **All**, **Attended**, or **Absent**
- By role: **All Roles**, **Organizers**, or **Hosts** (hosts who aren't organizers)
- **Voting Reps**, when the meeting was linked to a group that uses voting

The table is split into pages once it has more than 10 rows.

### Who can see who attended

The participant list, with names, emails, and attendance, is shown to organizers and to people who were invited to the meeting or who attended it. Anyone else who can open the page sees the attendance totals, but not who was there.

## Recording, transcript, and AI summary

The recording, transcript, and AI summary exist only if the organizer turned them on when scheduling the meeting. See [Schedule a Meeting](../schedule-meeting/).

### Who can see them

You need to be **signed in** to use the join page's **Meeting Tools**, and able to open the meeting. Two things decide who can use the recording, transcript, and AI summary.

**Who can open the meeting.**

- For a **public meeting with no join restriction**, any signed-in user.
- Otherwise, organizers, people who were invited, people who attended, and members of a group linked to the meeting.

**The organizer's setting.** Organizers choose **Who can access recordings & summaries** when they turn these features on:

- **Meeting Hosts Only**: only organizers and Meeting Hosts.
- **Meeting Guests** (the default): organizers, Meeting Hosts, and guests.
- **Public**: publicly accessible. Think twice before choosing this for a Private or Restricted meeting, because it makes the recording, transcript, and summary available to people outside the meeting.

So a public meeting's recording isn't open to every signed-in user when its setting is **Meeting Hosts Only**.

### Read the transcript

The details page shows a **Transcripts** tag when a transcript exists. To read it, open the meeting's join page and use the **Meeting Tools** panel. See [Join a Meeting](../join-meeting/).

### AI summary approval

When an organizer turns on the AI meeting summary, they can also select **Requires host approval before sharing with guests**. This is off by default.

- **If approval isn't required**, the summary is available to people with access as soon as it's ready.
- **If approval is required**, the summary stays hidden from everyone except organizers until an organizer approves it. Then it shows an **Approved** badge. Until then, organizers see **Pending**.

To review a summary, organizers use the meeting's card on the **Past** tab:

1. Look for the banner "AI summary is awaiting your review" and select **Review Summary**.
2. Read the summary in the **Meeting Summary** window. To change it, select **Edit**, make your changes, and select **Save**.
3. Select **Approve** to share it. Once approved, the window shows **Approved**.

Only organizers can edit or approve a summary.

## Related

- [Reconcile Attendance](../reconcile-attendance/) — match Zoom attendees to real people
- [Meetings overview](../) — an overview of the Meetings section
- [Meeting Materials](../meeting-materials/) — manage a past meeting's files and links
- [Join a Meeting](../join-meeting/) — read a transcript and use the Meeting Tools panel
- [Schedule a Meeting](../schedule-meeting/) — turn on the recording, transcript, and AI summary
