---
title: Events and Event Attendees
description: How the Organization lens Events page and People → Event Attendees count and list people at events, what each filter (Range, Foundation, Count, Show, Counted by) does, what is shown about each person, and what the attendees and speakers panels for an event show.
audience: [all]
product_area: Organization
tags: [organization, org, org-lens, events, event-attendees, registered, attended, counted-by, company-email, filters, all-employees, speakers]
last_updated: 2026-11-06
intercom_collection: Organization
---

These steps apply to anyone with access to at least one organization in the Organization lens. The Events page, People → Event Attendees and the **Event Attendees** and **Event Speakers** cards on the [Org Overview](../org-overview/) all use the same definitions, so the same selection gives the same number on each of them. A CLA (Contributor License Agreement) Manager or initial CLA Manager designee with no other role on an organization sees only its **EasyCLA** page, not these pages.

## What is counted

- Every number counts **people**, each once, not registrations. A person who registered for three events is one person in a total and three events in their own row.
- **All** (the default) counts everyone who registered or attended, each person once, except cancelled and denied registrations. A person who attended without a registration on record is counted too.
- **Registered** counts everyone who registered, except cancelled and denied registrations.
- **Attended** counts only people marked as attended. Only events that have ended are counted. Upcoming events have no attendance yet, so they always show registrations, whether **All**, **Registered** or **Attended** is picked.
- People figures count events that have ended. Upcoming events appear on the Events page only.
- **Speakers** are accepted speakers. The Events page also shows how many speaker proposals were submitted.

## Counted by

**Counted by** decides whom an event number is credited to. It is under **More filters**, and the link shows **More filters (1)** while a non-default option is picked.

| Option                                  | What it counts                                                                                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Company email or employee** (default) | People who registered or spoke with an email address the organization has on record as its own, and its current employees on the roster. People who only named the organization on their registration (self-declared) are left out. |
| **All relations**                       | Everyone above, plus people who only named the organization on their registration (self-declared), including registrations credited to the organization's account. This is the widest view.                                         |
| **Company email**                       | People who registered with one of the organization's own email addresses.                                                                                                                                                           |
| **Account on registration**             | Registrations credited to the organization's account, whatever address was used.                                                                                                                                                    |

If you pick **Company email** and the organization has no company-email data, it is not available: the numbers use **Account on registration** instead and the page says so. **Company email or employee** and **All relations** need no company-email data.

### Who is listed

Everyone credited to the organization by the current **Counted by** is listed by name in People → Event Attendees and in an event's attendees drawer, so you can review who is counted. By default that is only people who registered or spoke with a company email address on record and current employees on the roster. **All relations** adds, by name, the people who only named the organization on their registration (self-declared). Job titles are shown only for the organization's current employees on the roster, as on People → Trainees; everyone else is shown by name only. A person whose name or title on record is an email address appears without it: as **Registered attendee** when there is no usable name, and with no title. Email addresses are never shown in these lists. With **Count** set to **All**, the attendees drawer shows each person as **Registered or attended**. An event's speakers drawer lists the organization's accepted and submitted speakers for that event, whether or not they registered.

## Events page

Open **Events** in the Organization lens sidebar. The three tiles at the top, **Upcoming Events**, **Past Events** and **Total Events**, follow the filters below, except search, status and the tab you are on.

| Filter                              | What it does                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Range** (Past tab only)           | Past events that ended within the last 30 days, 90 days, 1 year or 2 years, or all time. The default is 2 years.                                                                                          |
| **Foundation**                      | Events of one foundation. The default is **All Foundations**; the list offers the foundations that have events under the current **Show** and **Counted by**.                                             |
| **Count**                           | **All** (default, registered or attended), **Registered** or **Attended**. It is disabled on the Upcoming tab, where registrations are always counted.                                                    |
| **Show**                            | **My org's activity** (default): events where the organization has registrants, a submitted speaker or a sponsorship. **All foundation events** also lists events with no activity from the organization. |
| **Counted by** (under More filters) | See [Counted by](#counted-by).                                                                                                                                                                            |

The **Event Attendees** column header and cells explain what the number counts when you point at them. Select an attendee count to open the people behind it.

### What do the attendees and speakers panels show?

Selecting an event's attendee count or speaker count opens a panel that names the organization's people at that event. Both panels have a **Search people...** box that matches names and job titles, and list each person with their job title when known. Email addresses are never shown.

| Panel     | Opens from                                                                     | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attendees | The **Event Attendees** count                                                  | The title is the organization's name followed by **Attendees**, and the line under it is the event name and how many people are counted, such as **14 counted**. Everyone counted under the current **Counted by** is listed by name, so the list matches the count; by default that is **Company email or employee** (see [Who is listed](#who-is-listed)). Each person carries the **Count** you picked: **Registered or attended**, **Registered** or **Attended**. A count of **0** cannot be selected |
| Speakers  | The **Event Speakers** count, shown as accepted / submitted, such as **2 / 5** | The title is the organization's name followed by **Speakers**, and the line under it is the event name and how many of the organization's speaker proposals were accepted and submitted, such as **2 accepted of 5 submitted**. Each speaker is marked **Accepted** or **Submitted**. A count of **0 / 0** cannot be selected                                                                                                                                                                              |

When a panel has no one to show, it says **No attendees found for this event.** or **No speakers found for this event.** A search that matches no one says **No attendees match your search.** or **No speakers match your search.** If the attendees panel fails to load, it says **Could not load attendees. Close this panel and open it again to retry.** The speakers panel has no separate error message: if it fails to load, it shows **No speakers found for this event.**, so close it and open it again before you rely on an empty list.

The filters are kept in the page address (`?range=`, `?foundation=`, `?participation=`, `?eventScope=`, `?attribution=`), left out while they are at their defaults, and carried when you switch between the Upcoming and Past tabs. **Clear filters** returns all of them, and the search and status, to their defaults.

## People → Event Attendees

Open **People** and then **Event Attendees**. The filters are **Range**, **Foundation**, **Event**, **Count** and, under **More filters**, **Counted by**; they mean the same as above. **Range**, **Count** and **Counted by** are kept in the page address and applied to the numbers themselves; **Foundation**, **Event** and the search narrow the people listed.

- The tiles describe the current **Range**, **Count** and **Counted by**:
  - **Attendees**, **Speakers**, **Events** and **Foundations** are the organization's totals for the selection. When you narrow the list with search, **Foundation** or **Event**, all four count the people listed instead (for Speakers, the listed people shown with a speaker role; for Events and Foundations, the events and foundations those people took part in), so the four tiles always agree with each other.
- A person with a roster profile opens the person drawer when you select their name. A person without one is shown by name only.
- Select a row to see the events that person registered for or attended in the selected range.

## Org Overview

The Overview cards always use the defaults: **Company email or employee**, **All** (registered or attended) and the last 2 years. They have no filters. Their headline counts each person once, so it is not the sum of the monthly points in the chart. To see other selections, including **All relations**, open the Events page or People → Event Attendees.

## People → All Employees

The **Event Attendees** tile on **People** → **All Employees** is the same number as **Attendees** on People → Event Attendees at its defaults (**Company email or employee**, **All**) for the same organization and **Range**: the people who registered or attended a foundation event in that range. It does not change with the project scope, because events are Linux Foundation events; the exception is **Non-LF projects**, which have no events, where the tile counts the listed employees who took part in an event. It does not change with the **Employment** view or the **Team members** filter either. If the figure cannot be read, the tile shows a dash (—) instead of counting something else.
