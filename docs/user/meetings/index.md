---
title: Meetings
description: Schedule, manage, and join project meetings with calendar integration in LFX Self Serve.
audience: [all]
product_area: Meetings
tags: [meetings, schedule, calendar, join, zoom, virtual]
last_generated: 2026-05-22
last_updated: 2026-08-10
intercom_collection: Meetings
---

The Meetings section lets you create, manage, and join meetings for your Linux Foundation project groups. Meetings include Technical Steering Committee (TSC) calls, working group sessions, and other recurring or one-time project gatherings.

## What you can do

- View upcoming and past project meetings
- Schedule new meetings, choosing a video platform and recurrence pattern
- Edit existing meeting details (title, time, agenda, platform)
- Join meetings via the public meeting join page — no LFX account required
- Register yourself for a public, non-restricted meeting you weren't invited to (requires signing in)
- RSVP (Yes/No/Maybe) to a meeting you're invited to (requires signing in)
- Generate a draft meeting agenda with AI assistance, or start from a pre-built agenda template
- View a past meeting's recording, transcript, and AI summary, if you have access
- Upload or view meeting materials (files and links)
- Invite guests directly or by linking a project committee
- Subscribe to a live calendar feed of a project's or foundation's meetings

## Who this applies to

All authenticated users can view meetings for their projects. Contributors have view-only access.

Creating and managing meetings requires a **maintainer**, **board-member**, or **executive-director** persona — or, for a specific project, a user who has been granted **Meeting Coordinator** access for that project even without one of those personas.

No meeting ever strictly requires an LFX account to view or join. A **Private** meeting is joinable by anyone with the link, which carries the meeting's password as a query parameter — no sign-in involved. A **Restricted** meeting checks the email or username you provide against its registrant list; that's a registrant-match check, not an authentication requirement.

## Navigation

The left navigation label for this section depends on which lens you're in:

- **Me lens** (your personal view): the sidebar item is **My Meetings**, at route `/meetings`. This shows meetings across all of your projects, but does not include a way to create a new meeting.
- **Foundation or Project lens**: the sidebar item is **Meetings**, scoped to that foundation or project. This is where the **Create Meeting** button appears, if you have write access.
- **Org lens**: the sidebar item is also labeled **Meetings**, but it opens a meeting analytics view for the org rather than the shared meetings dashboard — there's no Create Meeting button here.

Me, Foundation, and Project lenses share the same dashboard, just scoped differently. Time filters: **Upcoming** and **Past**. In the Me lens, an additional **Pending RSVP** filter (Upcoming only) and **Organized by me** filter (Upcoming and Past) are available.

Empty states differ by lens:

- Me lens, no upcoming meetings: "No upcoming meetings — Meetings from your committees and projects will appear here."
- Foundation/Project/Org lens, no upcoming meetings: "No meetings yet — Schedule a meeting to get started."

## Key concepts

- **Meeting dashboard**: The list (or calendar) view of meetings, scoped to your current lens
- **Meeting join page**: A public URL where attendees can view meeting details and join without signing in, unless the meeting is Private or Restricted
- **Meeting Not Found page**: Shown when a meeting link is invalid, expired, or the meeting was deleted or cancelled
- **Restricted meeting**: A meeting that only lets in people who match an existing registrant record (by email or username) — there's no separate meeting passcode
- **Calendar subscription**: From the Foundation or Project lens dashboard, the **Subscribe** button gives you a live ICS feed URL for that project's or foundation's meetings, which you add once to your calendar app. The feed excludes **Private** meetings; **Restricted** meetings that are otherwise public still appear on it. There is no per-meeting ICS download.

## Public meeting access

Every meeting has a join link at `/meetings/:id`, and viewing or joining it never requires an LFX account. This page shows meeting details and the information you need to join. The meeting organizer's name and contact link are only shown to signed-in visitors — unauthenticated visitors see the meeting details without organizer contact info. If a meeting is marked **Restricted**, you'll need to submit an email or username that matches an existing registrant to see full join details; contact the meeting organizer to be added as a registrant.

## Related sections

- [Committees](../committees/) — committees hold regular meetings
- [Documents](../documents/) — meeting agendas and notes may be stored as documents
- [Events](../events/) — for public LFX conferences and events
