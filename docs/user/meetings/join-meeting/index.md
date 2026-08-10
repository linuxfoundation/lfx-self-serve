---
title: Join a Meeting
description: How to join a project meeting via the public LFX meeting link.
audience: [all]
product_area: Meetings
tags: [meetings, join, public, attendee]
last_generated: 2026-05-22
last_updated: 2026-08-10
intercom_collection: Meetings
---

Every project meeting hosted in LFX Self Serve has a join page that does not require an LFX account, including Private and Restricted meetings. Opening the link takes you straight to that meeting's details — there's no list to pick from first.

## Steps

1. Open the meeting join link shared by your meeting organizer. The link follows the format: `https://app.lfx.dev/meetings/{meeting-id}`.
2. The page shows the meeting title, date and time, and a join button (if the meeting is starting soon or already underway). If you're signed in, it also shows who's organizing the meeting. Use the **Copy meeting link** button if you want to save or forward it.
3. If the meeting is marked **Restricted**, you'll need to submit an email or username that matches an existing registrant to see full join details — see "Restricted meetings" below.

## No account required

The meeting join page (`/meetings/:id`) never requires an LFX account, for any meeting. A **Private** meeting's join link carries the meeting's password as a query parameter, so anyone with the link can join without signing in. A **Restricted** meeting checks the email or username you submit against its registrant list instead of requiring sign-in.

## Meeting not found

If you open a meeting link and see the **Meeting Not Found** page, it's usually one of: the link has expired or is no longer valid, the meeting was deleted or cancelled, you need access to a restricted meeting, or there's a typo in the URL. Contact the meeting organizer for a correct link, or use the **Contact Support** button on that page.

## Restricted meetings

There's no passcode you enter manually. Instead, some meetings are marked **Restricted**, which means only people who submit an email or username matching an existing registrant record can see full join details. If you hit this, ask the meeting organizer to add you as a registrant. Note that the organizer's name and contact link are only shown on the join page to signed-in visitors — if you're not signed in, sign in or ask whoever shared the link with you to reach the organizer on your behalf.

## Related

- [Meetings overview](../) — an overview of the Meetings section
- [Schedule a Meeting](../schedule-meeting/) — for organizers creating a new meeting
