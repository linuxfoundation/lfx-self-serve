---
title: Meetings
description: Schedule, manage, and join project meetings with calendar integration in LFX Self Serve.
audience: [all]
product_area: Meetings
tags: [meetings, schedule, calendar, join, zoom, virtual]
last_generated: 2026-05-22
last_updated: 2026-05-22
intercom_collection: Meetings
---

The Meetings section lets you create, manage, and join meetings for your Linux Foundation project groups. Meetings include Technical Steering Committee (TSC) calls, working group sessions, and other recurring or one-time project gatherings.

## What you can do

- View upcoming and past project meetings
- Schedule new meetings with calendar integration
- Edit existing meeting details (title, time, agenda)
- Join meetings via the public meeting join page
- Generate meeting agendas with AI assistance
- Download meeting details as calendar files (ICS format)

## Who this applies to

All authenticated users can view meetings for their projects. Creating and managing meetings requires a maintainer, board-member, or executive-director persona. The public meeting join page (`/meetings/:id`) is accessible without authentication.

## Navigation

Go to **app.lfx.dev** and select **Meetings** from the left navigation sidebar. The meetings dashboard (route: `/meetings`) shows upcoming and recent meetings for your active project context. Tabs: **Upcoming**, **Past**, **Pending RSVP**. Empty state: "No upcoming meetings / Meetings from your committees and projects will appear here."

## Key concepts

- **Meeting dashboard**: The list view of all meetings for your project
- **Meeting join page**: A public URL where attendees can join a meeting without signing in
- **Meeting not found page**: Shown when a meeting ID does not match any known meeting
- **Calendar integration**: Meetings can be added to your calendar via ICS file download

## Public meeting access

Each meeting has a public join link at `/meetings/:id`. This page is accessible without authentication and shows the meeting details and join information. Attendees do not need an LFX account to view the join page.

## Related sections

- [Committees](../committees/) — committees hold regular meetings
- [Documents](../documents/) — meeting agendas and notes may be stored as documents
- [Events](../events/) — for public LFX conferences and events
