---
title: Host Controls and the Host Key
description: What the Zoom host key is, who can see it, when it is available, and how to use it to claim host in a meeting.
audience: [all]
product_area: Meetings
tags: [meetings, host, host key, zoom, recording, host controls]
last_updated: 2026-10-28
intercom_collection: Meetings
---

The **host key** is a 6-digit code that lets a person claim host in a Zoom meeting. Use it when you need host controls in the meeting, for example to stop the recording or the AI Companion. LFX Self Serve meetings run on Zoom, so the host key applies to every meeting. The key is shown to meeting hosts on the meeting's join page, and to organizers on the meeting card, so you don't have to look it up in Zoom.

## Who can see the host key

Only meeting hosts can see the key, and you need to be signed in. There are two kinds of host:

- **Organizers** are the people who manage the meeting: its owner, and people with write access to the meeting's project or committee, including users granted **Meeting Coordinator** access. An organizer is always a host too.
- **Meeting Hosts** are guests (participants) who were marked as a **Meeting Host** when they were invited. They don't need to be organizers. Being a Meeting Host gives them enough access to run the meeting, including the host key, but not to edit it.

Everyone else, including guests and attendees who aren't hosts, never sees the key.

|                                         | Organizer | Meeting Host (guest) | Other guests |
| --------------------------------------- | --------- | -------------------- | ------------ |
| Host key on the meeting's join page     | Yes       | Yes                  | No           |
| **Host Key** button on the meeting card | Yes       | No                   | No           |
| Edit, cancel, or delete the meeting     | Yes       | No                   | No           |
| Mark a guest as a Meeting Host          | Yes       | No                   | No           |

If you're a Meeting Host and don't see a card button, open the meeting's join page instead. If you need to make someone a host, ask an organizer.

## When the host key is available

The key is available for a limited time around each meeting:

- It appears **70 minutes before** the meeting starts.
- It stays available until **40 minutes after** the meeting's scheduled end.

For a recurring meeting, the window follows the next upcoming occurrence. Outside the window, or after the meeting is over, the key isn't shown. Past meetings never show a host key. Because the key can change between occurrences, don't save it for later. Open it again when you need it.

If you check too early or too late, the meeting card shows: "The host key isn't available right now. It's only visible to meeting hosts, starting 70 minutes before the meeting."

## Find the host key

### From the meeting card (organizers)

1. Sign in to [app.lfx.dev](https://app.lfx.dev) and open **Meetings**.
2. Find the upcoming meeting. When it is inside the availability window, its card shows a **Host Key** button.
3. Select **Host Key**. A panel opens with a masked **Host Key** tag.
4. Select the tag to reveal the key, or select it again to hide it. Select the copy icon (**Copy host key**) to copy it to your clipboard.

### From the join page (organizers and Meeting Hosts)

1. Open the meeting's join page at `https://app.lfx.dev/meetings/{meeting-id}`, and make sure you're signed in.
2. When the meeting is inside the availability window and you're a host, a **Host controls** panel appears on the page.
3. Select the masked **Host Key** tag to reveal the key, and use the copy icon to copy it.

The key stays hidden until you select it, so it isn't exposed to anyone looking over your shoulder or in a shared screen.

Organizers can use either place. Meeting Hosts who aren't organizers use the join page.

## Use the host key in Zoom

To stop the recording or the AI Companion:

1. Join the meeting in Zoom.
2. In Zoom, open **Participants → Claim Host**.
3. Enter the host key.

You become the host of the meeting and can use the host controls.

## Make someone a meeting host

Organizers can give a guest the access to run the meeting by marking them as a **Meeting Host** when they invite them:

1. Open the meeting's editor from **Create Meeting**, or from **Edit** on the meeting card.
2. Go to the **Invite guests** section and select **Add guest**.
3. Enter the guest's details and select **Meeting Host**.
4. Save the meeting.

A guest marked as a host shows a **Host** label in the guest list. For the rest of the guest list, see [Manage Participants](../manage-participants/).

## Troubleshooting

- **I don't see the Host Key button on the meeting card.** The button is only for organizers, and only for upcoming meetings inside the availability window. If you're a Meeting Host rather than an organizer, open the meeting's join page instead.
- **I'm a host but the key isn't on the join page.** Make sure you are signed in, and that the meeting is within 70 minutes of its start and not yet 40 minutes past its end. If you're still missing it, ask an organizer to confirm you're marked as a **Meeting Host**.
- **The key doesn't work in Zoom.** Reopen the key from the meeting card or join page and copy it again. The key can change between occurrences.
- **I can't find the key after the meeting.** Past meetings never show the host key.

## Related

- [Meetings overview](../) — an overview of the Meetings section
- [Schedule a Meeting](../schedule-meeting/) — create a new meeting and choose its features
- [Manage Meetings](../manage-meetings/) — edit, cancel, or delete meetings
- [Join a Meeting](../join-meeting/) — how attendees access the join page
