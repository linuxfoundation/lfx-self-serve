---
title: People
description: Read the People page in the Organization lens — the All Employees table, what each column counts, and how the Key Contact column shows a person's key-contact roles.
audience: [all]
product_area: Organization
tags: [organization, org, people, employees, key-contacts, roles]
last_updated: 2026-10-28
intercom_collection: Organization
---

**People** lists everyone associated with the selected organization and what each of them does across Linux Foundation projects: board and committee seats, key-contact roles, code contributions, event attendance and training.

These steps apply to anyone who can open the People page for an organization in the Organization lens.

## Where do I find People?

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Switch to the **Organization** lens and select the organization.
3. Open **People**, or go directly to `/org/<organization>/people`.

The page opens on **All Employees**. The other tabs — **Board**, **Committee**, **Key Contacts**, **Contributors**, **Event Attendees**, **Trainees** and **Org Lens Access** — each narrow the page to one group of people. The tab you pick is kept in the address, so you can link someone straight to it.

## What the All Employees table shows

One row per person, with a column for each kind of engagement:

| Column                               | What it shows                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Employee**                         | Name, job title, and a **Former** tag when the person has left the organization                          |
| **Board & Committee**                | How many board or committee seats the person holds                                                       |
| **Key Contact**                      | The key-contact roles the person holds on the organization's memberships                                 |
| **Commits** / **Code contributions** | Code activity in the selected time range. The heading follows the measure you pick above the table       |
| **Events**                           | Events attended                                                                                          |
| **Training**                         | Courses taken                                                                                            |
| **Org Lens Access**                  | **Admin**, **Viewer** or **Invited** when the person can open this organization in the Organization lens |

Select any column heading to sort by it. Select it again to reverse the order.

A dash (—) means the person has nothing in that column.

## The Key Contact column

A **key contact** is someone named on one of the organization's memberships as the person to reach for a particular purpose — billing, legal, technical, and so on. The same roles are listed in full on the **Key Contacts** tab; this column puts them next to everything else a person does.

What you will see in the column:

- **One role** — the role name, in the same colour it has on the Key Contacts tab. The nine roles are Representative/Voting Contact, Authorized Signatory, Billing Contact, Technical Contact, Marketing Contact, PO Contact, PR Contact, Legal Contact and Event Sponsorship Contact.
- **More than one role** — a single chip reading, for example, **2 roles**, so that one person holding several roles does not stretch the row. Hover over the chip, or move to it with the keyboard and leave it focused, to see the roles listed. Screen readers read the full list without needing to focus it.
- **No roles** — a dash (—).

Sorting by **Key Contact** orders people by how many roles they hold, most first.

### Why does someone have no role here when they are on the Key Contacts tab?

The column counts only roles that are currently in force. A role is left out when:

- The membership it belongs to is no longer active — for example it has lapsed or been cancelled. Only a membership the organization currently holds counts.
- The contact record itself is not active — for example it is still pending.
- The role cannot be matched to any of the organization's memberships.

The person still appears in the table in all of these cases; only the role is left out.

## Where this information comes from

The table is assembled from LFX board and committee seats, LFX membership contact records, project maintainer and contributor data, and event attendance. The same list appears under the table.

Key-contact roles follow the organization's membership records, so a change made on the **Key Contacts** tab — adding, replacing or removing a contact — shows up here as soon as the page is reloaded.

## Related sections

- [Organization](../) — the Organization lens
- [EasyCLA](../easycla/) — corporate CLAs for the selected organization
