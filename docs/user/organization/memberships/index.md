---
title: Memberships and membership detail
description: How to read the Memberships list for the selected organization, open a foundation membership, and review or update its key contacts, board and committee seats, and membership agreements.
audience: [all]
product_area: Organization
tags: [organization, org, org-lens, memberships, membership, key-contacts, board, committee, agreements]
last_updated: 2026-11-06
intercom_collection: Organization
---

These steps apply to anyone who can open an organization in the Organization lens, such as an organization admin (editor or viewer). A CLA (Contributor License Agreement) Manager or initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager) with no other role on an organization sees only its **EasyCLA** page, not **Memberships**. To pick the organization the page shows, see [Choose and switch an organization](../choose-an-organization/).

## What is the Memberships page?

The Memberships page lists the selected organization's foundation memberships: which are active, which have expired, and which foundations it can join. Its address is `/org/<organization>/memberships`.

The page heading is **Membership —** followed by the organization's name. The sidebar item that opens it is **Memberships**. The page has three tabs: **Active**, **Expired**, and **Discover**.

From the [Org Overview dashboard](../org-overview/), **View all on Memberships page ›** also opens this list.

## How do I open Memberships?

You open **Memberships** from the Organization lens sidebar once an organization is selected. A CLA Manager or initial CLA Manager designee with no other role on that organization is sent to **EasyCLA** instead.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Organization** in the lens switcher.
3. Select **Memberships** in the sidebar. On a phone or small screen, selecting **Organization** in the navigation menu only shows that lens's menu: select **Memberships** in it.

If your only role on that organization is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).

When you cannot open the organization, Memberships is replaced by the same access message as the other Organization lens pages, such as **You do not have access to this organization**. Those messages are covered in [What happens when a link does not open an organization?](../choose-an-organization/#what-happens-when-a-link-does-not-open-an-organization).

## What do the summary cards count?

The three cards on **Active** summarize the organization's active memberships, and they stay the same when you search or filter the table.

| Card                        | What it counts                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Active Memberships**      | How many active foundation memberships the organization has                                                                                     |
| **Renewing Within 90 Days** | How many of those memberships have a tier end date between today and 90 days from today. A tier end date that has already passed is not counted |
| **Governance Roles**        | The board seats and committee seats on those memberships, added together                                                                        |

While the list is loading, or when it fails to load, each card shows a dash (**—**) instead of a number. A count of zero shows **0**.

## How do I find an active membership?

Use the search box and the two menus above the **Active** table. The three summary cards stay as they are. The table shows only the rows that match.

1. In **Search memberships...**, type part of a foundation name. The search matches the foundation name.
2. Open the membership level menu. It starts on **All Membership Levels**. The other choices are the tiers on this organization's memberships.
3. Open the renewal menu. It starts on **All Renewals**. Choose **Renewing in 90 Days** or **Renewing in 30 Days** to keep memberships whose tier end date is on or before that many days from today, including a tier end date that has already passed. A membership with no tier end date is left out. Because these choices also keep a tier end date that has already passed, **Renewing in 90 Days** can list more rows than the **Renewing Within 90 Days** card counts.

When the table has no rows, including when a search or filter matches nothing, it says **No active memberships** and **This organization does not have any active memberships.** When the list fails to load, it says **Failed to load memberships** and **Please try again.** Select **Retry**.

## What does each active membership row show?

Each row is one foundation membership. Select the foundation name to open its membership detail page. A row with no foundation address shows the same name and is not a link.

| Column                | What it shows                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**              | The foundation logo, or initials when there is no logo, the foundation name, and a line with the project count, the word **projects**, a middle dot, the member count, and the word **members** |
| **Membership Tier**   | The tier name, and under it the tier start and end as a month and year, separated by an en dash                                                                                                 |
| **Member Since**      | The month and year the membership started, or a dash (**—**) when that date is missing                                                                                                          |
| **Board Members**     | How many board seats this membership has                                                                                                                                                        |
| **Committee Members** | How many committee seats this membership has                                                                                                                                                    |
| **Org Projects**      | How many projects your organization is involved in at that foundation. A number above 0 opens the **Org Projects** panel. **0** is text and does not open the panel                             |

The line under the foundation name is not the **Org Projects** count. **Org Projects** is the last column.

## What does the Org Projects panel show?

The **Org Projects** panel lists the projects your organization is involved in at that foundation. It opens from a number in the **Org Projects** column.

The panel title is **Org Projects**. Under it is the foundation name, a middle dot, the count, and the word **project** or **projects**.

1. Select the number in **Org Projects**.
2. To narrow the list, use **Search projects...**.
3. Select a Linux Foundation (LF) project name to open that project's detail page. The panel closes. See [What is a project detail page?](../projects/#what-is-a-project-detail-page). A project that is not an LF project is shown as text and is not a link.

Each project shows an influence word under its name. The words **Leading**, **Contributing**, and **Participating** are the named levels. To the right, each project shows **LF maintainer roles**, **Contributors**, and **Commits**.

**LF maintainer roles** is a count for LF projects only. A project that is not an LF project, or one whose maintainer roles could not be read, shows a dash (**—**) instead of a number. The info button next to **LF maintainer roles**, labeled **How maintainer roles are counted**, says: **Maintainer roles: people named as maintainers in a project's governance files, counted once per project, credited to their current employer, in LF projects over the past 2 years, team members left out.**

When the search matches nothing, the panel says **No projects match your search.** When the foundation has no projects in the panel, it says **No projects found for this foundation.** While the list is loading, the panel status is **Loading projects…**. When the load fails, it says **Unable to load projects.** and **Failed to load projects.** Select **Retry**.

## What does the Expired tab show?

The **Expired** tab lists memberships that are no longer active. The heading is **Expired Memberships**, and the line under it is **Projects your organization had active memberships for, but are currently expired**.

1. Select **Expired**.
2. In **Search...**, type part of a foundation name. The search matches the foundation name only.

Each row shows the foundation, a line **Expired** followed by the expiration date, the tier with its start and end dates, the **Expiration Date**, and **Actions**. Dates on this tab include the month, day, and year. A missing date shows a dash (**—**).

**Actions** is one of two controls:

- **Renew** opens the Linux Foundation enrollment site at [enrollment.lfx.linuxfoundation.org](https://enrollment.lfx.linuxfoundation.org/) in a new tab, with that foundation selected.
- **Contact Us** opens the support chat. If the chat cannot open, the page says **Support Unavailable** and **Support chat is unavailable right now. Please try again later.**

When the tab has no rows, including when the search matches nothing, it says **No expired memberships** and **All your memberships are current!** When the list fails to load, it says **Failed to load expired memberships** and **Please try again.** Select **Retry**.

## What does the Discover tab show?

The **Discover** tab lists foundations where the organization's people contribute to LF projects but the organization has no active membership, including foundations where its membership has expired. The heading is **Discover Opportunities**.

1. Select **Discover**.
2. Select **Join** on a row to open the enrollment site at [enrollment.lfx.linuxfoundation.org](https://enrollment.lfx.linuxfoundation.org/) in a new tab, with that foundation selected.

| Column            | What it shows                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| **Foundation**    | The foundation name, and under it the category, a middle dot, the count, and the words **relevant projects** |
| **Category**      | The suggested tier, with **Suggested tier** under it                                                         |
| **Contributors**  | How many of the organization's people contributed to that foundation's LF projects in the last 12 months     |
| **Contributions** | How many commits the organization's people made to those projects                                            |
| **Actions**       | **Join**                                                                                                     |

When there are no rows, the tab says **No new opportunities available right now** and **Check back later for new membership opportunities.** When the list fails to load, it says **Failed to load discover opportunities** and **Please try again.** Select **Retry**.

## What does a membership detail page show?

A membership detail page is one foundation membership for the selected organization. You open it by selecting the foundation name on the **Active** tab. Its address is `/org/<organization>/memberships/<foundation>`.

**Back to Memberships** returns to the list. The heading is the foundation name. The line under it is the membership tier, the status **Active** or **Expired**, and **Member since** followed by the month and year.

The page has three tabs. The address ends in `#key-contacts` for **Key Contacts**, `#board` or `#board-committee` for **Board & Committee**, or `#docs` or `#documentation` for **Documentation**, and every other ending opens **Key Contacts**.

| Tab                   | What it shows                                        |
| --------------------- | ---------------------------------------------------- |
| **Key Contacts**      | The people named on this membership, by contact type |
| **Board & Committee** | Board seats and committee seats, and who holds them  |
| **Documentation**     | Membership agreements for this foundation            |

When the membership cannot be loaded, the page says **Failed to load membership detail** and **Please try again.** Select **Retry**. When the foundation is not a membership of this organization, the page says **Membership not found** and **We couldn't find that membership for your organization.** Select **Back to Memberships**.

## How do I change a key contact?

You change a key contact from the pencil on the **Key Contacts** tab, when that pencil is enabled. The dialog title is **Edit Key Contact**. It names the foundation and the contact type.

The tab lists nine contact types, in this order. Hover a type to read what it is for. An empty type says **No** followed by the type name and **assigned**, such as **No Billing Contact assigned**.

| Contact type                      | What the hover text says                                                 | How many this membership can have |
| --------------------------------- | ------------------------------------------------------------------------ | --------------------------------- |
| **Representative/Voting Contact** | Primary voting representative for your organization on this membership.  | One, and one is required          |
| **Billing Contact**               | Receives invoices and billing communications for this membership.        | At least 1, and up to 3           |
| **Technical Contact**             | Primary technical point of contact for this membership.                  | At least 1, and up to 10          |
| **PO Contact**                    | Receives purchase-order communications.                                  | Up to 3. None is allowed          |
| **Marketing Contact**             | Coordinates marketing and co-branding activities.                        | At least 1, and up to 10          |
| **PR Contact**                    | Handles press and public-relations communications.                       | Up to 3. None is allowed          |
| **Legal Contact**                 | Receives legal and contractual communications.                           | Up to 3. None is allowed          |
| **Event Sponsorship Contact**     | Coordinates event sponsorship for this membership.                       | Up to 3. None is allowed          |
| **Authorized Signatory**          | Authorized to sign membership agreements on behalf of your organization. | One, and one is required          |

A blue note in the dialog repeats that limit. **Representative/Voting Contact** and **Authorized Signatory** say **Your organization must have one key contact of this type.** **Billing Contact** says **Your organization must have at least 1, and can have up to 3 contacts of this type.** **Technical Contact** and **Marketing Contact** say **Your organization must have at least 1, and can have up to 10 contacts of this type.** **PO Contact**, **PR Contact**, **Legal Contact**, and **Event Sponsorship Contact** say **Your organization can have up to 3 contacts of this type.**

1. Open the membership and select **Key Contacts**.
2. Select the pencil on the row. When the row has nobody, the button name is **Add** followed by the type and **for this membership**. When the row has someone, it is **Edit** followed by the type and **for this membership**. The enabled pencil's hover text is **Edit contact**.
3. For a type that holds one person, the dialog shows **Current Member** and **(to be removed)**, then **Assign to**. Enter **Email**, **First Name**, and **Last Name**. The email box placeholder is **Enter the employee's email address...**. Choose a person from the suggestions, or type the details. Select **Save Changes**.
4. For a type that can hold more than one person, the dialog asks **What would you like to do?** Select **Add Another Contact** (or **Add** followed by the type, when the row is empty) or **Remove Existing Contact**. **Add Another Contact** then shows **Assign to**. Enter **Email**, **First Name**, and **Last Name**. Choose a person from the suggestions, or type the details. Select **Save Changes**. To remove someone, select them under **Select contact to remove**, then select **Remove Contact**.
5. Select **Cancel** to close the dialog without saving.

**Save Changes** changes to **Saving…** while it saves. **Remove Contact** changes to **Removing…**. A saved change shows **Key contact updated**, **Key contact added**, or **Key contact removed**. A change that did not save shows **Could not save changes. Please try again.**

The dialog can show these messages:

- **Enter a valid email address** — the email is not valid.
- **This person is already a** followed by the type and a period, such as **This person is already a Billing Contact.** — that person already holds this type.
- **Maximum contacts reached** — the hover text on **Add Another Contact** when it is unavailable because the type is already at its maximum.
- **No contacts to remove** — the hover text on **Remove Existing Contact** when it is unavailable because the row is empty.
- **At least one contact required** — the hover text on **Remove Existing Contact** when it is unavailable because the type must keep someone.
- **Employee search is unavailable. You can still enter the contact's details manually.** — employee search is down. Type the person's details instead.

Selecting a person's name on this tab, or on **Board & Committee**, opens a panel with their details.

## Who can edit key contacts?

The pencil on **Key Contacts** is enabled when you are allowed to edit the selected organization.

When you are not allowed to edit, the pencil is disabled. Its hover text is **Only admins can edit. To view a list of admins, visit the Access page.** That list is the **Org Lens Access** tab under **People**. See [Manage Org Lens Access](../manage-org-lens-access/).

## What does the Board & Committee tab show?

The **Board & Committee** tab lists who holds this membership's board seats and committee seats. The heading is **Board & Committee Members**.

1. Select **Board & Committee**.
2. To narrow both lists, use **Search by name, role, committee, voting status, or email...**. **Clear search** removes what you typed. When a list has seats but none match, it says **No people match your search.** and offers **Clear search**.
3. Open **Board Seats** or **Committee Seats**. The number in parentheses is how many seats that list has. A list that failed to load shows **?** instead of a number, then **Couldn't load Board Seats** or **Couldn't load Committee Seats**, and **Please try again.** Select **Retry**.
4. Select **Export CSV** to download the board and committee seats. The file includes every seat, not only the rows the search is showing. **Export CSV** is unavailable when both lists are empty.

An empty board list says **No board seats for this membership.** An empty committee list says **No committee seats for this membership.**

Board rows have **Name**, **Role**, **Voting**, and **Actions**. Committee rows add **Committee**. **Voting** shows the seat's voting status, or a dash (**—**) when it has none. Select a person's name to open their details.

## How do I reassign a board or committee seat?

You reassign a seat from the pencil on a row you are allowed to change. The pencil's hover text is **Edit contact**. The dialog title is **Reassign Board Roles** for both a board seat and a committee seat.

1. On the seat's row, select the pencil.
2. Under **Select roles to reassign**, leave the role checked, or use **Select all**. The badge on the row is **Board** or **Committee**.
3. Under **Assign to**, enter **Email**, **First Name**, and **Last Name**. The email box placeholder is **Search by name or email…**.
4. Select **Save Changes** followed by the number of roles in parentheses, such as **Save Changes (1 role)**.

The note in the dialog says **Each selected role must be held by someone at all times. The person you assign below will replace the current member in every role you've checked above.** The current holder is marked **CURRENT MEMBER · WILL BE REMOVED FROM SELECTED ROLES**.

While it saves, the button says **Reassigning…**. A saved board change shows **Board roles reassigned**. A saved committee change shows **Committee seat reassigned**. A change that did not save shows **Reassignment failed — please retry.**

An email that is not valid shows **Enter a valid email address**. A person who already holds the selected role shows **This person already holds the selected role(s).** When employee search is down, the dialog says **Employee search is unavailable. You can still enter the contact's details manually.** Select **Cancel** to close without saving.

A seat you cannot change has no pencil. It has **Why can't I edit?** That dialog is titled **Why can't I edit this member?** and shows the reason for that seat. When the seat has no reason, it says **This seat is controlled by the foundation and cannot be edited from your organization's view.** Select **Got it** to close it.

## What does the Documentation tab show?

The **Documentation** tab lists membership agreements for this foundation. The heading is **Membership Agreements**.

1. Select **Documentation**.
2. Select **View** on an agreement to open it in a new tab. A **View** that cannot open the file is gray, and its hover text is **Document not available**.
3. Select the download button at the right of the heading to download every agreement as a CSV file. Its hover text is **Download all as CSV**. When there are no agreements, the button is unavailable and its hover text is **No agreements to download**.

Each agreement shows its name, **Signed** followed by the date, the file format, and the size in KB when a size is available. The agreement in force is marked **Current**.

When there are no agreements, the tab says **No membership agreements found.** When the documents fail to load, it says **Failed to load documents** and **Please try again.** Select **Retry**.

## Why did Memberships fail to load?

A failed load keeps you on the same tab and tells you to retry. It is not the same as an empty list.

| What you see                                                       | What to do                                     |
| ------------------------------------------------------------------ | ---------------------------------------------- |
| **Failed to load memberships**                                     | Select **Retry** on **Active**                 |
| **Failed to load expired memberships**                             | Select **Retry** on **Expired**                |
| **Failed to load discover opportunities**                          | Select **Retry** on **Discover**               |
| **Failed to load membership detail**                               | Select **Retry** on the detail page            |
| **Failed to load documents**                                       | Select **Retry** on **Documentation**          |
| **Couldn't load Board Seats** or **Couldn't load Committee Seats** | Select **Retry** in that section               |
| **Failed to load projects.**                                       | Select **Retry** in the **Org Projects** panel |

A dash (**—**) on the three **Active** cards, while the table says **Failed to load memberships**, means the counts did not load either.

## Related sections

- [Choose and switch an organization](../choose-an-organization/) — pick the organization these memberships belong to
- [Org Overview dashboard](../org-overview/) — the **Dashboard**, including **View all on Memberships page ›**
- [Projects and project detail](../projects/) — the organization's projects, and each project's influence and leaderboards
- [Manage Org Lens Access](../manage-org-lens-access/) — who is an Admin, and who can edit the organization
- [EasyCLA](../easycla/) — corporate CLAs (Contributor License Agreements) for the selected organization
- [Organization FAQ](../faq/) — short answers about the Organization lens
