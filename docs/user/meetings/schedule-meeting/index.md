---
title: Schedule a Meeting
description: How to create a project meeting in LFX Self Serve, from a quick start to every setting.
audience: [all]
product_area: Meetings
tags: [meetings, schedule, create, recurring, zoom, recording, ai summary, agenda]
last_updated: 2026-10-28
intercom_collection: Meetings
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** personas, or anyone granted **Meeting Coordinator** access for the project. Use it to create a new meeting, either with a quick start or with every setting. Meetings run on Zoom.

## Before you begin

Confirm you have the correct project selected. Meetings are associated with a specific project (or committee within it), and the active context in your lens switcher decides which project the meeting is linked to.

## Start a new meeting

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Switch to your **Project** or **Foundation** lens using the lens switcher, then select **Meetings** from the left navigation. Your personal **Meetings** view doesn't have a **Create Meeting** button, so you need to be in a Project or Foundation lens.
3. Select **Create Meeting**. A menu lists **Quick start / Templates** by meeting type, and **Advanced** ("Configure every aspect of your meeting").

Pick a meeting type for a quick start, or **Advanced** to set everything yourself.

## Quick start

Choosing a meeting type opens the **Create meeting** window. It has the essentials, and it fills in a **title**, a **duration**, and a suggested **agenda** for the type you picked. These start as suggestions, so edit any of them freely. If you pick a different type, the ones you haven't edited update to match.

In the window you can set:

- The **Meeting type**
- The title and agenda
- A group to invite
- The date, time, and duration

Select **Create meeting** when you're done. If you need guests, recordings, or resources, select **Switch to advanced mode** at the bottom of the window.

## Advanced: all the settings

**Advanced** opens the **Create meeting** drawer, which goes through five sections. **Details & Access** and **Date & schedule** are required. Use **Next** and **Back** to move between sections. A **Preview** shows the meeting as you build it, and **Create meeting** appears on the last section.

### Details & Access

- **Meeting title** (required).
- **Meeting type** (required): Technical, Maintainers, Board, Marketing, Legal, or Other.
- **Visibility**:
  - **Public**: listed on the public project calendar and discoverable in the app.
  - **Private**: hidden from the public calendar. Only guests with the meeting link can find it.
- **Join Restriction**:
  - **Anyone with the link**: anyone who has the meeting link can join.
  - **Invited guests only**: only invited guests can join. This makes the meeting **Restricted**.
- **Organizer**: defaults to the meeting's creator. You can choose someone else, or enter a name and email.

Choosing the **Board** type sets the meeting to **Private** and **Invited guests only**. If you switch away from Board, the meeting goes back to **Public** and unrestricted, so a non-board meeting isn't left with board-level settings.

### Date & schedule

- **Start date** and **Start time** (required). The time must be in the future, in a format like 9:30 AM.
- **Duration** (required): 15 min, 30 min, 45 min, 1 hour, 90 min, 2 hours, or **Custom** from 5 to 600 minutes.
- **Timezone** (required).
- **Early join**: how long before the start time guests can join: 10 min (the default), 15 min, 30 min, or 1 hour. This is useful for informal networking before the official start.

#### Repeat a meeting

To make the meeting recurring, turn on the repeat option ("This meeting repeats on a schedule"), then choose a **Cadence**. You need to pick a start date first, because the options are based on it.

- **Daily**
- **Weekly on** the day of your start date
- **Every weekday**
- **Monthly on** the first, second, third, fourth, or last day of the week matching your start date, such as "Monthly on the 2nd Tuesday"
- **Custom**: repeat every N days, weeks, or months. For weekly meetings, choose specific days of the week. For monthly meetings, choose either a fixed day of the month or a pattern like "the second Tuesday". The series ends **Never**, **On date**, or **After number of occurrences**.

### Platform & features

- **Platform**: Zoom.
- **Recording**: record the meeting for people who can't attend live.
- **AI meeting summary**: generate key takeaways and action items automatically. When this is on, you can also select **Requires host approval before sharing with guests**, so a summary stays hidden until an organizer approves it. See [Past Meetings](../past-meetings/).
- **Transcript**: automatically create searchable text transcripts. This needs **Recording** to be on.
- **Auto-upload to YouTube**: automatically publish recordings to your project's YouTube channel. This needs **Recording** to be on. The meeting date is added to the video's title when it uploads, so the title can be at most 87 characters. If it's longer, you'll see a "Meeting title too long for YouTube" warning with a link back to **Details & Access** to shorten it.
- **Reminder email**: automatically send a reminder email to all participants before the meeting starts. Set how long before the start it goes out, from 2 to 24 hours (plus 0 to 59 minutes). It defaults to 24 hours.

When **Recording** or **AI meeting summary** is on, **Who can access recordings & summaries** appears. Choose **Meeting Hosts Only**, **Meeting Guests** (the default), or **Public**.

### Invite guests

Add guests one by one, or link a project group. For all the options, including resending invitations and the **Show attendees to guests** setting, see [Manage Participants](../manage-participants/).

### Agenda & resources

- **Agenda**: write one yourself, or fill in the title, meeting type, and a short prompt and use AI assistance to generate a draft. Review and edit it before saving, since it's a starting point, not a final agenda. The **Agenda Templates** panel also offers pre-built templates for your meeting type.
- **Documents** and **Links**: attach files and links for attendees. See [Meeting Materials](../meeting-materials/).

## Create the meeting

On the last section, select **Create meeting**. You'll see **Meeting created**, and the meeting appears on the **Upcoming** tab of the project's **Meetings** dashboard. Invited participants see it in their meetings list.

## After you create a meeting

- Share the join link. See [Manage Meetings](../manage-meetings/).
- Find the host key shortly before the meeting starts. See [Host Controls and the Host Key](../host-controls/).
- Add or change materials at any time. See [Meeting Materials](../meeting-materials/).

## Related

- [Meetings overview](../) — an overview of the Meetings section
- [Manage Meetings](../manage-meetings/) — edit, cancel, or delete meetings
- [Manage Participants](../manage-participants/) — invite guests and add groups
- [Meeting Materials](../meeting-materials/) — add files and links
- [Host Controls and the Host Key](../host-controls/) — claim host in Zoom
