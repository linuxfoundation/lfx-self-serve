---
title: People
description: How to read the People page for the selected company — its All Employees, Board, Committee, Key Contacts, Contributors, Event Attendees, Trainees and Company Lens Access tabs — filter each tab, change board, committee and key contact seats as an Admin, and how the time range carries to Code Contributions.
audience: [all]
product_area: Company
tags: [company, org, org-lens, people, employees, contributors, maintainers, board, committee, key-contacts, events, training, time-range, team-members]
last_updated: 2026-11-12
intercom_collection: Company
---

These steps apply to anyone who can open a company in the Company lens, such as a company admin (editor or viewer). Changing board, committee and key contact seats also needs edit access to the company, which its Admins have. A CLA (Contributor License Agreement) Manager or initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager) with no other role on a company sees only its **EasyCLA** page, not **People**. To pick the company the page shows, see [Choose and switch a company](../choose-a-company/).

## What is the People page?

The People page lists the selected company's employees and how each one takes part in the Linux Foundation: board and committee seats, key contact roles, code contributions and maintainer roles, events, and training. Its address is `/company/<company>/people`.

The page heading is **People —** followed by the company's name. The line under it is **All employee involvement with the Linux Foundation — board, committees, maintainership, code, training, and events.** The page has eight tabs:

| Tab                     | What it lists                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **All Employees**       | Everyone with recorded activity, a seat, a contact role or Company Lens access, with all of it in one row (the default) |
| **Board**               | Employees who hold a seat on a foundation's governing board                                                             |
| **Committee**           | Employees who sit on foundation committees                                                                              |
| **Key Contacts**        | Employees named as contacts on the company's foundation memberships                                                     |
| **Contributors**        | Employees who contributed code, and whether they are maintainers                                                        |
| **Event Attendees**     | People who registered for, attended or spoke at events                                                                  |
| **Trainees**            | Employees who enrolled in courses or earned certifications                                                              |
| **Company Lens Access** | Who can open the company, covered in [Manage Company Lens Access](../manage-company-lens-access/)                       |

Select a person's name on any tab to open their details. On **Event Attendees**, only people with a roster profile have a selectable name; for anyone else, select the row to see their events.

### Which emails do a person's details show?

Under the person's name, their details list the email addresses they have on one of the company's own domains, the primary one first. Personal addresses and addresses at other employers are never shown. Former employees keep the addresses they had, and the **Former employee** badge still marks them. A key contact with no LF account shows the email on their key contact record, marked **from key contact record**. When no address is shown, the line says why:

| Message                                                                   | What it means                                                                                                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No verified company email associated with this LF profile**             | The person has an LF account, and it holds no verified address on the company's domains                                                                         |
| **This profile isn't linked to an LF profile - no company email on file** | This profile (a contributor profile, or a key contact with no LF username on their record) isn't linked to an LF profile, so there is no company email to show  |
| **We can't tell whether this person has an email at** _company_           | The LF username could not be matched to one LF account, so we can't tell whether they have an address on the company's domains; it does not mean they have none |
| **Emails aren't shown on this page**                                      | The page you opened them from carries nothing to look their addresses up with                                                                                   |
| **Couldn't load emails.**                                                 | The lookup failed. Select **Try again**                                                                                                                         |

## How do I open People?

You open **People** from the Company lens sidebar, under **Company Engagement**, once a company is selected. A CLA Manager or initial CLA Manager designee with no other role on that company is sent to **EasyCLA** instead.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Company** in the lens switcher.
3. In the sidebar, under **Company Engagement**, select **People**. On a phone or small screen, selecting **Company** in the navigation menu only shows that lens's menu: select **People** in it.
4. Select a tab. The tab you pick is kept in the page address, so a copied link opens the same tab.

If your only role on that company is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).

When you cannot open the company, People is replaced by the same access message as the other Company lens pages, such as **You do not have access to this company**. Those messages are covered in [What happens when a link does not open a company?](../choose-a-company/#what-happens-when-a-link-does-not-open-a-company).

## What does the All Employees tab show?

The **All Employees** tab shows the company's people in one table, one row per person, with their board and committee seats, code contributions, events, training and Company Lens access. It lists people with recorded Linux Foundation activity in the time range, and also people who hold a board or committee seat, a key contact role on one of the company's active memberships, or Company Lens access. A key contact role on a membership that has ended does not list anyone. It is the tab People opens on.

Five cards at the top count **Employees Active in Open Source**, **In Governance**, **Code Contributors**, **Event Attendees** and **Trainees**. The table has these columns:

| Column                  | What it shows                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Employee**            | The person's name and job title. **Former** marks someone who no longer works at the company                                                     |
| **Board & Committee**   | How many board and committee seats they hold, such as **2 seats**                                                                                |
| **Key Contact**         | The key contact roles they hold on the company's memberships, such as **Billing Contact** or **2 roles**                                         |
| **Code contributions**  | Their code count under the chosen code count. The heading changes to **Commits** when you count commits. Hover it for what it counts             |
| **Events**              | How many events they attended                                                                                                                    |
| **Training**            | How many courses they took                                                                                                                       |
| **Company Lens Access** | **Admin** or **Viewer** when they can open the company in the Company lens, or **Invited** when they have been invited and have not accepted yet |

A dash (**—**) means none. Select a row with a chevron to expand it. Rows without one, such as a person listed only for a seat or Company Lens access, have no detail to show. The expanded row lists the person's **Governance — Board Seats**, **Meetings — Committee Seats**, **Code Contributions**, **Events**, and **Training & Certifications**. When a person has nothing recorded there, it says **No LF activity detail recorded for this employee.**

A question-mark icon next to a name means the person has code credited to the company but no employment record there. They are listed only when **Employment** is **All employees**, not as a current or former employee.

The tab shows 30 people at first. Select **Show All** at the bottom to see the rest.

### What does the Key Contact column show?

The **Key Contact** column shows the key contact roles a person holds on the company's foundation memberships — the people named as the ones to reach for a particular purpose, such as billing or legal. The **Key Contacts** tab lists the same roles by foundation; this column puts them beside everything else the person does.

- **One role** — the role's name, coloured as it is on the **Key Contacts** tab. The roles are Representative/Voting Contact, Authorized Signatory, Billing Contact, Technical Contact, Marketing Contact, PO Contact, PR Contact, Legal Contact and Event Sponsorship Contact.
- **More than one role** — one chip counting them, such as **2 roles**, so a person with several roles does not stretch the row. Point at the chip, or move to it with the keyboard and leave it focused, to see the roles listed. Screen readers read the full list without focusing it.
- **No roles** — a dash (**—**).

Sorting by **Key Contact** orders people by how many roles they hold, most first.

Only roles that are currently in force count, and the **Key Contacts** tab counts them the same way. A role is left out of both when the membership it belongs to is no longer active, such as a lapsed or cancelled one; when the contact record itself is not active, such as a pending one; or when the role cannot be matched to any of the company's memberships. So a role missing here is missing from the **Key Contacts** tab too.

Someone whose roles are all left out still appears in **All Employees**, with a dash in this column, whenever they are listed for something else — a board or committee seat, recorded activity in the time range, or Company Lens access. Being listed in the table and holding a role that counts are separate things.

## What does the Contributors tab show?

The **Contributors** tab shows the employees who made at least one code contribution in the time range, with their role, their code count, when they were last active, and the project they were most active in.

Four cards at the top count **Maintainer roles**, **Contributors**, **Projects** and **Foundations**. Hover the info icon next to **Maintainer roles** or **Contributors** for how each is counted. All four cards follow the time range, project type and **Team members**. **Contributors**, **Projects** and **Foundations** also follow **Employment** and **Company scope**; **Maintainer roles** does not. The cards do not change with the code count, the search box, the foundation or the project.

| Column                  | What it shows                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Name**                | The person's name and job title                                                                             |
| **Role**                | **Maintainer** if they are named as a maintainer in a project's governance files, otherwise **Contributor** |
| **Code contributions**  | Their code count. The heading changes to **Commits** when you count commits. Hover it for what it counts    |
| **Last Active**         | The date of their most recent contribution                                                                  |
| **Most Active Project** | The project they contributed to most, with its foundation                                                   |

Select a row to expand it. **Projects Involved** lists each project they contributed to, with their **Role**, code count and **Last Active** date on it.

When maintainer data cannot be read, the **Role** column shows a dash (**—**) whose hover text is **Maintainer data is currently unavailable**. It does not mean the person is not a maintainer.

Each person is credited to the employer they had when they did the work, so with **Employment** set to **All employees**, the default, people who have since left are included. Bots are left out. People marked as team members in LFX are left out by default. See [What does Team members change on People?](#what-does-team-members-change-on-people).

The tab shows 30 people at first. Select **Show All** at the bottom to see the rest.

## What do the Board, Committee and Key Contacts tabs show?

The **Board**, **Committee** and **Key Contacts** tabs list the employees who hold seats or contact roles on the company's foundation memberships, one row per person. Select a row to expand it and see each seat or role by foundation. These tabs have no time range.

| Tab              | Cards                                                                                    | Columns                                      | Expanded row                                             |
| ---------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| **Board**        | **Total Board Members**, **Voting**, **Non-voting**, **Foundations with a board member** | **Name**, **Foundations**, **Voting Status** | **Foundation**, **Board / Committee**, **Voting Status** |
| **Committee**    | **Individuals**, **Committees**, **Foundations with committee members**                  | **Name**, **Foundations**, **Committees**    | **Foundation**, **Committee**, **Voting Status**         |
| **Key Contacts** | **Individuals**, **Foundations Covered**, **Unfilled Role Types**                        | **Name**, **Roles**, **Foundations**         | **Foundation**, **Contact Role**                         |

**Unfilled Role Types** turns red when one or more required contact roles have nobody in them.

You filter **Board** by foundation and by **All Statuses**, **Voting** or **Non-voting**. You filter **Committee** by foundation and committee, and **Key Contacts** by foundation and role.

### Who can change a board, committee or key contact seat?

An Admin of the company can change a seat from the pencil icon on its row. Anyone else cannot change seats on these tabs. On **Committee** and **Key Contacts** they see the pencil disabled, and on **Board** they see **Why can't I edit?** in its place. Either way the reason given is **Only admins can edit. To view a list of admins, visit the Access page.** That list is the **Company Lens Access** tab.

| Tab              | Pencil on the person's row                                                 | Pencil on a seat or role                                     |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Board**        | **Reassign board roles**, which opens **Reassign Board Roles**             | **Edit board role**, which opens **Edit Board Role**         |
| **Committee**    | **Reassign committee roles**, which opens **Reassign Committee Roles**     | **Edit committee role**, which opens **Edit Committee Role** |
| **Key Contacts** | **Reassign key contact roles**, which opens **Reassign Key Contact Roles** | **Edit contact**, which opens **Edit Key Contact**           |

Some seats are controlled by the foundation, so even an Admin cannot change them from the company's view. On **Committee**, the pencil on such a seat is disabled and its hover text gives the reason, such as **This seat is foundation-controlled and not editable here.** On **Board**, such a seat shows **Why can't I edit?** in place of the pencil. Selecting it opens **Why can't I edit this member?** with the reason. Select **Got it** to close it. When none of a person's board or committee seats can be changed, the hover text on their row is **No org-reassignable seats for this person**.

### How do I reassign a person's board, committee or key contact roles?

You reassign them from the pencil on the person's row, which opens **Reassign Board Roles**, **Reassign Committee Roles** or **Reassign Key Contact Roles**. All three work the same way.

1. On the person's row, select the pencil.
2. Under **Select roles to reassign**, leave checked the roles to hand over, or use **Select all**. The person who holds them now is marked as being removed from the selected roles.
3. Under **Assign to**, enter the new person's **Email** (the box says **Enter the employee's email address...**), **First Name** and **Last Name**.
4. Select **Save Changes** followed by the number of roles, such as **Save Changes (1 role)**. While it saves, the button says **Reassigning…**.

A saved change shows **Board roles reassigned**, **Committee roles reassigned** or **Roles reassigned**. When only some board or committee roles were reassigned, it shows **Some reassignments did not succeed**. When only some key contact roles were reassigned, **Reassign Key Contact Roles** stays open and says how many succeeded, followed by **Reopen this dialog to retry the remaining roles with fresh state.** Close it and open it again before you retry. To change a single key contact, use the pencil on that role, which opens **Edit Key Contact**, the same dialog as on a membership page. Its steps are in [How do I change a key contact?](../memberships/#how-do-i-change-a-key-contact).

## What do the Event Attendees and Trainees tabs show?

The **Event Attendees** tab shows the people who registered for, attended or spoke at events in the time range. Its cards count **Speakers**, **Attendees**, **Events** and **Foundations**, and its columns are **Name**, **Role** (**Speaker** or **Attendee**), **Events**, **Last Attended** and **Most Recent Event**. By default **Count** is **All**, which counts everyone who registered or attended: choose **Attended** to count only people marked as attended. People are counted by **Employee match** only. Everyone counted as an attendee is listed by name; for speakers, see [Who is listed](../company-events/#who-is-listed). The filters and what each option counts are in [Events and Event Attendees](../company-events/).

The **Trainees** tab shows the employees who enrolled in a course or earned a certificate in the time range.

- **Filters:** a search box and the time range, and under **More filters**, **Foundation**, **Project**, **Course**, **Level** and **Format**. **Clear all** resets the five filters under **More filters**, and keeps the time range and the search. The filters change both the cards and the table. The search changes the table only.
- **Cards:** the tab opens with three cards, **People with training activity**, **Courses taken** and **Certified people**. Select **Show 7 more stats** for the others: **Training-program roster members**, **Learners not on the people list**, **Certifications**, **Trainings completed**, **Completion rate**, **Courses in progress** and **People in training**; **Show fewer stats** hides them again. Point at a card to see what it counts. **Training-program roster members** is today's count of the people on the company's LF Education training program, and does not follow the time range or the filters.
- **Columns:** **Name**, **Status** (**Certified** or **Enrolled**), **Courses**, **Certs**, **Trainings**, **In progress** and **Most Recent Course**.
- **Former employees:** former employees on the people list can count in the cards, but the table lists current employees only. A note under the cards says how many, except while a foundation, project, course, level or format is selected: the note is then hidden, though they can still be counted.
- **Learners not on the people list:** learners linked to the company who are not on its people list are listed under the table by name and status. The list is closed at first, with its count in the header: select the header to open it. A note there says that one person can appear more than once, for example with several training accounts under different emails, and that an org admin can review the list if a name looks familiar. The list is hidden while a foundation, project, course, level or format is selected.

Select a row on either tab to expand it and see each event, course or certification. **Event Attendees** shows 30 people at first: select **Show All** at the bottom to see the rest. On **Trainees**, the table and the **Learners not on the people list** list each have their own pages of 10 rows, with page numbers and **Showing 1 to 10 of N** at the bottom. When a list has more than 10 people, the menu next to the page numbers shows 25 or 50 rows per page. A new search, filter, time range or sort goes back to the first page.

## How do I filter a People tab?

You filter a People tab with the search box and menus above its table. Which menus a tab has depends on the tab. **All Employees** and **Contributors** have the most:

1. Type in the search box to find a person. On **All Employees**, **Search by name, title, email or username...** matches a person's name, job title, email or LF username, and ignores case, accents and spaces, so `jose ramirez` finds **José Ramírez**. On **Contributors**, **Search contributors...** finds a person by name or job title.
2. Open the foundation menu, which starts on **All Foundations**, and select a foundation. On **Contributors**, also pick a project in the menu that starts on **Any project**.
3. On **All Employees**, pick an activity: **All Activity**, **Board & Committee**, **Code contributions** (or **Commits**, when you count commits), **Events** or **Training**.
4. Select a time range: **Past 30 days**, **Past 90 days**, **Past 365 days**, **Past 2 years** or **All time**. **Past 2 years** is the default.
5. Select a project type: **LF and non-LF projects** (the default), **LF projects** or **Non-LF projects**. LF projects are Linux Foundation (LF) projects.
6. Select **More filters** to show the code count, **Employment**, **Company email** (All Employees only), **Key Contact** (All Employees only), **Team members** and **Company scope**. The link counts how many of them are set to something other than their default, such as **More filters (1)**.
7. On **All Employees** and **Contributors**, select **Clear filters** to put every filter back to its default, the time range included. It shows once a filter is changed.

**Employment** offers **Current employees**, **Former employees** and **All employees** (the default). On **All Employees** under **Current employees**, the **Code Contributors** card leaves out people who have since left. With **All employees** it shows the same number as the **Contributors** tab's **Contributors** card for the same time range, project type, company scope and team members choice.

**Company email**, on **All Employees**, offers **All email statuses** (the default), **Has company email**, **No verified company email** and **Unlinked profile**. **No verified company email** means the person has an LF account with no verified address on the company's domains. **Has company email** includes a key contact with no LF account whose key contact record carries an address on the company's domains. **Unlinked profile** means their emails could not be checked: mostly contributor profiles and key contacts with no LF account behind them, plus people whose LF username could not be matched to one LF account. These match the answer a person's details give (see [Which emails do a person's details show?](#which-emails-do-a-persons-details-show)). The filter is kept in the page address (`?companyEmail=`). The statuses are refreshed with the company data, so a just-added address can take up to a day to count. When they cannot be read, everyone is listed under **All email statuses** only.

**Key Contact**, on **All Employees**, offers **All key contact roles** (the default), **Any key contact role**, **Not a key contact**, and each of the nine roles: Representative/Voting Contact, Authorized Signatory, Billing Contact, Marketing Contact, Technical Contact, PO Contact, PR Contact, Legal Contact and Event Sponsorship Contact. Choosing a role lists everyone who holds it, including people who hold other roles too. **Any key contact role** and **Not a key contact** split the list in two. A role that is not one of the nine is matched only by **Any key contact role**. It uses the same roles as the Key Contact column and is kept in the page address (`?keyContact=`).

The code count offers **All code contributions** (the default), **All commits** and **Only main branch commits**. It changes the code numbers, not who is listed, with one exception: when the **All Employees** activity filter is on **Code contributions** (or **Commits**), only people whose count under the chosen option is above zero are shown. Someone with reviews or comments but no commits drops out when you switch to **All commits**. What each option counts is in [What do All code contributions, All commits and Only main branch commits count?](../code-contributions/#what-do-all-code-contributions-all-commits-and-only-main-branch-commits-count).

## What does Team members change on People?

**Team members** chooses whether people marked as team members in LFX count toward code contributions and maintainer roles. They are left out by default, as LFX Insights does. Choose **Include team members** to count them. Board and committee seats, events and training are not affected.

**Team members** is on **All Employees** and **Contributors**, under **More filters**. When the team member data cannot be read, the tab says **Team-member data is unavailable; counts include team members.** When **Contributors** finds nobody at the default view, it notes that team members are left out and that choosing **Include team members** shows them.

Your choice carries to **Code Contributions** and **Projects** when you move between them from the sidebar. See [Company scope](../../dashboards/#company-scope) on the Dashboard page, which also covers **Team members**.

## What does Company scope change on People?

**Company scope** chooses which of the companies count toward code contributions on **All Employees** and **Contributors**. **Insights company**, the default, counts only the company shown on the company's LFX Insights page, in the repositories LFX Insights counts. **All related companies** counts every company linked to the company account, in every repository.

On **All Employees** the choice **Applies to code contributions only.** Seats, events and training are counted the same way under both choices. See [Company scope](../../dashboards/#company-scope).

## Does the time range carry from People to Code Contributions?

Yes. The time range you pick on People carries to **Code Contributions** when you open it from the sidebar, and back again. **Company scope** and **Team members** carry the same way.

- The time range is shared by the People tabs that have one: **All Employees**, **Contributors**, **Event Attendees** and **Trainees**. Switching tabs keeps it.
- Project type, the code count, the foundation, and **Employment** do not carry to **Code Contributions**. It opens on its own defaults for those.
- **Clear filters** on **All Employees** or **Contributors** puts the time range back to **Past 2 years**, so **Code Contributions** then opens on **Past 2 years** too.

See [Code Contributions](../code-contributions/) for that page.

## Why is a People tab empty, or why did it fail to load?

A tab that finds nobody says so in its table, and a tab that fails to load names what failed and offers **Retry**. An empty tab is not the same as a failed load.

| What you see                                                                                     | Where                                      | What to do                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------ |
| **No employees match the current filters.**, and the same for other tabs                         | Any tab, with filters set                  | Clear the search or change the menus                   |
| **No employees found for this company.**                                                         | **All Employees**                          | The company has no recorded activity in the time range |
| **No contributors found for this company in the** time range                                     | **Contributors**                           | **Choose All time to include older contributions.**    |
| **No board members found.**, **No committee members found.**, **No key contact data available.** | **Board**, **Committee**, **Key Contacts** | The company has no seats or contacts on record         |
| **Former employees couldn't be loaded, so only current employees are shown.**                    | **All Employees**                          | The list is incomplete. Reload the page later          |
| **Failed to load employees**, **Failed to load contributors**, and so on                         | Any tab                                    | Select **Retry**                                       |
| **Failed to load activity detail.**                                                              | An expanded **All Employees** row          | Select **Retry** in the row                            |

## Related sections

- [Code Contributions](../code-contributions/) — the company's repositories and commits, with the same time range
- [Choose and switch a company](../choose-a-company/) — pick the company these people belong to
- [Company Overview dashboard](../company-overview/) — the **Dashboard**, with the company's involvement at a glance
- [Memberships](../memberships/) — the foundation memberships behind the board, committee and key contact seats, and the steps for editing a single key contact
- [Events and Event Attendees](../company-events/) — the **Event Attendees** filters, defaults and what each option counts
- [Manage Company Lens Access](../manage-company-lens-access/) — the **Company Lens Access** tab
- [Training & Certification](../training/) — the company's courses and certifications by course, with the same cards and filters as **Trainees**
- [Company FAQ](../faq/) — short answers about the Company lens
