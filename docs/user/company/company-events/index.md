---
title: Events and Event Attendees
description: How the Company Lens Events page and People → Event Attendees count people at events, what each filter (Range, Foundation, Count, Show, Counted by) does, and why some people are counted but not listed.
audience: [all]
product_area: Company
tags: [company, company-lens, events, event-attendees, registered, attended, counted-by, filters, all-employees]
last_updated: 2026-11-05
intercom_collection: Company
---

These steps apply to anyone with access to at least one company in the Company Lens. The Events page, People → Event Attendees and the **Event Attendees** and **Event Speakers** cards on the [Company Overview](../company-overview/) all use the same definitions, so the same selection gives the same number on each of them.

## What is counted

- Every number counts **people**, each once, not registrations. A person who registered for three events is one person in a total and three events in their own row.
- **All** (the default) counts everyone who registered or attended, each person once, except cancelled and denied registrations. A person who attended without a registration on record is counted too.
- **Registered** counts everyone who registered, except cancelled and denied registrations.
- **Attended** counts only people marked as attended. Only events that have ended are counted. Upcoming events have no attendance yet, so they always show registrations, whether **All**, **Registered** or **Attended** is picked.
- People figures count events that have ended. Upcoming events appear on the Events page only.
- **Speakers** are accepted speakers. The Events page also shows how many speaker proposals were submitted.

## Counted by

**Counted by** decides whom an event number is credited to. It is under **More filters**, and the link shows **More filters (1)** while a non-default option is picked.

| Option                      | What it counts                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **All relations** (default) | Everyone related to the company by either of the two below, and its current employees. This is the widest view. |
| **Company email**           | People who registered with one of the company's own email addresses.                                            |
| **Account on registration** | Registrations credited to the company's account, whatever address was used.                                     |

If you pick **Company email** and the company has no company-email data, it is not available: the numbers use **Account on registration** instead and the page says so. **All relations** needs no company-email data.

### People who are counted but not listed

With **Count** set to **All**, the attendees drawer shows each person as **Registered or attended**. An attendee is named in an attendee list, row or drawer only when they registered with a company email address or are a current employee of the company. Everyone else is counted in the totals but never named, and the page shows how many: **N counted, not listed**, or **N more counted, not listed** in an event's attendees drawer. A registrant with no usable name appears as **Registered attendee**. An event's speakers drawer works differently: it names the company's accepted and submitted speakers for that event, whether or not they registered. Email addresses are never shown anywhere.

## Events page

Open **Events** in the Company Lens sidebar. The three tiles at the top, **Upcoming Events**, **Past Events** and **Total Events**, follow the filters below, except search, status and the tab you are on.

| Filter                              | What it does                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Range** (Past tab only)           | Past events that ended within the last 30 days, 90 days, 1 year or 2 years, or all time. The default is 2 years.                                                                                    |
| **Foundation**                      | Events of one foundation. The default is **All Foundations**; the list offers the foundations that have events under the current **Show** and **Counted by**.                                       |
| **Count**                           | **All** (default, registered or attended), **Registered** or **Attended**. It is disabled on the Upcoming tab, where registrations are always counted.                                              |
| **Show**                            | **My company's activity** (default): events where the company has registrants, a submitted speaker or a sponsorship. **All foundation events** also lists events with no activity from the company. |
| **Counted by** (under More filters) | See [Counted by](#counted-by).                                                                                                                                                                      |

The **Event Attendees** column header and cells explain what the number counts when you point at them. Select an attendee count to open the people behind it. Linux Foundation staff also see the event's registration goal next to the count.

The filters are kept in the page address (`?range=`, `?foundation=`, `?participation=`, `?eventScope=`, `?attribution=`), left out while they are at their defaults, and carried when you switch between the Upcoming and Past tabs. **Clear filters** returns all of them, and the search and status, to their defaults.

## People → Event Attendees

Open **People** and then **Event Attendees**. The filters are **Range**, **Foundation**, **Event**, **Count** and, under **More filters**, **Counted by**; they mean the same as above and **Range**, **Count** and **Counted by** are also kept in the page address. Range, Count and Counted by are applied to the numbers themselves; **Foundation**, **Event** and the search narrow the people listed.

- The tiles describe the current **Range**, **Count** and **Counted by**:
  - **Attendees**, **Speakers**, **Events** and **Foundations** are the company's totals for the selection, including people who are counted but not listed, with the **N counted, not listed** note under Attendees. When you narrow the list with search, **Foundation** or **Event**, all four count the people listed instead (for Speakers, the listed people shown with a speaker role; for Events and Foundations, the events and foundations those people took part in) and the note is hidden, so the four tiles always agree with each other.
- A person with a roster profile opens the person drawer when you select their name. A listed person without one is shown by name only.
- Select a row to see the events that person registered for or attended in the selected range.

## Company Overview

The Overview cards always use the defaults: **All relations**, **All** (registered or attended) and the last 2 years. They have no filters. Their headline counts each person once, so it is not the sum of the monthly points in the chart. To see other selections, open the Events page or People → Event Attendees.

## People → All Employees

The **Event Attendees** tile on **People** → **All Employees** is the same number as **Attendees** on People → Event Attendees at its defaults (**All relations**, **All**) for the same company and **Range**: the people who registered or attended a foundation event in that range. It does not change with the project scope, because events are Linux Foundation events; the exception is **Non-LF projects**, which have no events, where the tile counts the listed employees who took part in an event. It does not change with the **Employment** view or the **Team members** filter either. If the figure cannot be read, the tile shows a dash (—) instead of counting something else.
