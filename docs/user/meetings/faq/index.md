---
title: Meetings FAQ
description: Frequently asked questions about meetings in LFX Self Serve.
audience: [all]
product_area: Meetings
tags: [meetings, faq, schedule, join]
last_generated: 2026-05-22
last_updated: 2026-08-10
intercom_collection: Meetings
---

## Who can create meetings?

Users with **maintainer**, **board-member**, or **executive-director** personas can create and manage meetings for their projects. A project can also grant an individual **Meeting Coordinator** access specifically for meetings, which lets them create and manage meetings for that project even if they don't otherwise hold one of those personas. Contributors without that grant can view meeting details but cannot create or edit meetings.

## Does an attendee need an LFX account to join a meeting?

Not for a standard public meeting. Each non-restricted meeting has a public join page at `/meetings/:id` that's accessible without authentication — you can share this link with anyone.

If a meeting is marked **Restricted**, the attendee needs to already be on the meeting's registrant list (matched by their email or username) to see full join details. That's a registration check, not a passcode — see "Can I protect a meeting with a passcode?" below.

## What is the AI agenda generation feature?

When creating or editing a meeting, you can fill in a title, meeting type, and a short prompt, then use AI assistance to generate a draft agenda. Review and edit the suggestion before saving — it's a starting point, not a final agenda.

## Can I schedule recurring meetings?

Yes. The meeting creation form has a full recurrence builder: repeat every N days, weeks, or months; for weekly meetings, choose specific days of the week; for monthly meetings, choose either a fixed day of the month or a pattern like "the second Tuesday." Set the series to end on a specific date or after a set number of occurrences.

## How do I add meetings to my calendar?

There's currently no button to download a single meeting as its own ICS file. Instead, from the **Meetings** dashboard in your Foundation or Project lens, use the **Subscribe** button to get a live calendar feed (ICS URL) covering all of that project's or foundation's meetings. Add that feed once to Google Calendar, Outlook, or Apple Calendar, and it stays up to date automatically.

## What happens when I open a meeting link and see "Meeting Not Found"?

This can happen if the link has expired or is no longer valid, the meeting was deleted or cancelled, the meeting is restricted and you don't have access, or there's a typo in the URL. Contact your meeting organizer for a correct link, or use the "Contact Support" option on that page.

## Can I protect a meeting with a passcode?

There's no separate passcode field for meetings. Access control works through the **Restricted** meeting setting instead: a restricted meeting only shows full join details to people who match an existing registrant (by email or username). If you need access to a restricted meeting, ask the organizer to add you as a registrant rather than asking for a passcode.

## Why can't I see a meeting I was invited to?

Make sure you're in the right lens: your personal **My Meetings** view (Me lens) shows meetings across all your projects, while a project's **Meetings** page (Project lens) only shows that project's meetings. Use the lens switcher to move between them. If you only have the join link, you can open it directly in your browser — no account or project context needed, unless the meeting is restricted.
