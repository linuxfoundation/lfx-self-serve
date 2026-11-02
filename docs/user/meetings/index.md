---
title: Meetings
description: Schedule, manage, and join project meetings in LFX Self Serve, with Zoom, recordings, attendance, and calendar integration.
audience: [all]
product_area: Meetings
tags: [meetings, schedule, calendar, join, zoom, virtual]
last_updated: 2026-10-28
intercom_collection: Meetings
---

The Meetings section lets you schedule, manage, and join meetings for your Linux Foundation project groups. Meetings include Technical Steering Committee (TSC) calls, working group sessions, and other recurring or one-time project gatherings. Meetings run on Zoom.

## Find what you need

| I want to                                                  | Go to                                            |
| ---------------------------------------------------------- | ------------------------------------------------ |
| Find my meetings, filter by my response, or add a calendar | [Meetings Dashboard and Filters](dashboard/)     |
| Join a meeting, respond to an invitation, or remove myself | [Join a Meeting](join-meeting/)                  |
| Create a meeting                                           | [Schedule a Meeting](schedule-meeting/)          |
| Edit, cancel, or delete a meeting                          | [Manage Meetings](manage-meetings/)              |
| Invite guests, add a group, or resend an invitation        | [Manage Participants](manage-participants/)      |
| Add or find a meeting's files and links                    | [Meeting Materials](meeting-materials/)          |
| Find the Zoom host key                                     | [Host Controls and the Host Key](host-controls/) |
| See who attended, or find a recording or AI summary        | [Past Meetings](past-meetings/)                  |
| Match Zoom attendees to real people                        | [Reconcile Attendance](reconcile-attendance/)    |
| Get quick answers                                          | [Meetings FAQ](faq/)                             |

## Who can do what

- **Everyone who is signed in** can see the meetings they're invited to and their projects' meetings. Contributors have view-only access.
- **Organizers** create and manage meetings. You're an organizer of a particular meeting when you have organizer access to it, for example because you created it. The **maintainer**, **board-member**, and **executive-director** personas, and **Meeting Coordinator** access, let you create and manage meetings for a project. Organizers manage a meeting's guests and materials, and can reconcile attendance after it runs. An organizer is always a host too.
- **Meeting Hosts** are guests an organizer marked as a host. They can see the host key and run the meeting in Zoom, but they can't edit the meeting.

## Who can see and join a meeting

An organizer sets two things when scheduling a meeting. **Visibility** is **Public** or **Private**. **Join Restriction** is **Anyone with the link** or **Invited guests only**, which makes the meeting **Restricted**. Together they decide who can open the meeting, and what they see.

- **Public, with no join restriction**: anyone can open the join page and see the meeting's details and how to join. You need to sign in to see materials, the organizer's contact link, and recordings.
- **Private**: hidden from the public calendar and from calendar feeds. Anyone with the meeting link can join, because the link carries the meeting's password, and they don't need an LFX account. People who aren't invited see only the title and what they need to join. They don't see the agenda, materials, or the date and time.
- **Restricted**: you need to **sign in**, and your account has to match someone on the guest list. Organizers can also join, and members of a linked group are on the list. There's no passcode to type and no form to get past it. If you need access, ask the organizer to add you, then sign in. Without access, the link shows **Meeting Not Found**.

See [Join a Meeting](join-meeting/) for the steps. A **Board** meeting is Private and Restricted by default, and it never shows its guest list to guests.

## Key concepts

- **Meetings dashboard**: the list or calendar of meetings, scoped to your current lens. See [Meetings Dashboard and Filters](dashboard/).
- **Join page**: the page at `/meetings/{meeting-id}` where you see a meeting's details and join it. Each meeting has one.
- **Occurrence**: one date of a recurring meeting. You can edit, cancel, or add materials to a single occurrence without changing the rest of the series.
- **Past meeting**: a meeting that has run. It has its own details page with attendance, and its materials move onto it.
- **Meeting Not Found page**: shown when a link is invalid or expired, or the meeting was deleted or cancelled.

## Related sections

- [Committees](../committees/) — committees hold regular meetings
- [Documents](../documents/) — meeting agendas and notes may be stored as documents
- [Events](../events/) — for public LFX conferences and events
