---
title: Training & Certification
description: How to read the Company lens Training & Certification page — its ten cards, the Certifications and Trainings tabs, the time range, Group by and More filters, what Clear all resets, the people behind each number, and what a company family roll-up shows.
audience: [all]
product_area: Company
tags: [company, org, org-lens, training, certification, certifications, trainings, courses, group-by, filters, time-range, roll-up, company-family]
last_updated: 2026-11-25
intercom_collection: Company
---

These steps apply to anyone who can open a company in the Company lens, such as a company admin (editor or viewer). A CLA (Contributor License Agreement) Manager or initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager) with no other role on a company sees only its **EasyCLA** page, not **Training & Certification**. To pick the company the page shows, see [Choose and switch a company](../choose-a-company/).

## What is the Training & Certification page?

The Training & Certification page shows the Linux Foundation training courses and certifications that the selected company's people enrolled in or completed over a time range, grouped by course, foundation, project, level or format. Its address is `/company/<company>/training`.

The sidebar item is **Training & Certification**. The page heading is **Training & Certifications —** followed by the company's name, and the line under it is **Training enrollments and certifications across your company.** The page has, from top to bottom:

1. Ten cards that count the company's learners and courses.
2. Two tabs, **Certifications** (the default) and **Trainings**, over one table.
3. A filter bar above the table: a name search, the time range, **Group by** and **More filters**.
4. A note under the table that says what its numbers count.

The cards and their definitions are the same as on the **Trainees** tab of [People](../people/#what-do-the-event-attendees-and-trainees-tabs-show), for the same time range and filters.

## How do I open Training & Certification?

You open **Training & Certification** from the Company lens sidebar, under **Company Engagement**, once a company is selected.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Company** in the lens switcher.
3. In the sidebar, under **Company Engagement**, select **Training & Certification**. On a phone or small screen, selecting **Company** in the navigation menu only shows that lens's menu: select **Training & Certification** in it.
4. Select the **Certifications** or **Trainings** tab. The tab, the time range, **Group by** and the filters under **More filters** are kept in the page address, so a copied link opens the same view.

If your only role on that company is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).

When you cannot open the company, the page is replaced by the same access message as the other Company lens pages, such as **You do not have access to this company**. Those messages are covered in [What happens when a link does not open a company?](../choose-a-company/#what-happens-when-a-link-does-not-open-a-company).

## What do the cards on Training & Certification count?

The page opens with three cards, **People with training activity**, **Courses taken** and **Certified people**. Select **Show 7 more stats** for the others, and **Show fewer stats** to hide them again; the values are the same either way. The ten cards count the company's learners and their courses for the selected time range and filters, except **Training-program roster members**, which is today's count and follows neither. Courses are counted as person-course pairs: one person in one course, counted once even when they retook it. Point at or select a card to see its full definition, unit and the date its data is as of.

| Card                                | What it counts                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Training-program roster members** | Today's count of the people the company's LF Education (Linux Foundation training) program lists, including people who never enrolled in a course. It says **No LF Education training program on record for this company** when there is none                                                                                           |
| **People with training activity**   | People on the company's people list with an enrollment or a certificate in the time range. With the default time range and no filters, it equals the **Trainees** card on People › All Employees for the same time range, which counts current employees, plus any former employees still on the people list with training in the range |
| **Learners not on the people list** | People linked to the company who are not on its people list, with an enrollment or a certificate in the time range. Shown as a dash (**—**) and not counted while a foundation, project, course, level or format is selected. Not part of the other cards                                                                               |
| **Courses taken**                   | Person-course pairs with an enrollment or a certificate in the time range. It equals **Certifications** plus **Trainings completed** plus **Courses in progress**                                                                                                                                                                       |
| **Certifications**                  | Courses taken of certification products that ended in a certificate in the time range                                                                                                                                                                                                                                                   |
| **Certified people**                | People on the company's people list holding a certification certificate dated in the time range                                                                                                                                                                                                                                         |
| **Trainings completed**             | Courses taken of training products that ended in a certificate in the time range                                                                                                                                                                                                                                                        |
| **Completion rate**                 | **Certifications** plus **Trainings completed**, divided by **Courses taken**                                                                                                                                                                                                                                                           |
| **Courses in progress**             | Courses enrolled in the time range with no certificate in the time range                                                                                                                                                                                                                                                                |
| **People in training**              | People with at least one course in progress                                                                                                                                                                                                                                                                                             |

Except for **Training-program roster members** and **Learners not on the people list**, the cards count people on the company's people list only. **Courses in progress** and **People in training** are not a snapshot of today: they are judged by the time range alone. An enrollment in the range with no certificate in the range counts as in progress, even if it has since been abandoned. An enrollment from before the range does not.

If the cards cannot load, they are replaced by **Couldn't load training stats** and a **Retry** button. The table is not affected.

## What do the Certifications and Trainings tabs show?

The **Certifications** tab lists certification products and the **Trainings** tab lists every other training product, in one table grouped by what you pick in **Group by**. **Certifications** is the tab the page opens on. The **In progress** totals of the two tabs add up to the **Courses in progress** card.

The table has these columns. Select a column heading to sort by it. The table starts sorted by its **Certified** or **Completed** column, highest first.

| Column                                                                    | What it shows                                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| The **Group by** choice, such as **Course** (the default)                 | The course, foundation, project, level or format. A course row also names its foundation and level, and a project row its foundation |
| **People**                                                                | How many people took a course in that row                                                                                            |
| **Courses taken**                                                         | Person-course pairs in that row                                                                                                      |
| **Certified** (on **Certifications**) or **Completed** (on **Trainings**) | Person-course pairs that ended in a certificate in the time range                                                                    |
| **In progress**                                                           | Person-course pairs enrolled in the time range with no certificate in it                                                             |

A dash (**—**) means none. A row without the grouped value is shown as **No course name**, **No foundation**, **No project**, **No level** or **No format**.

The **Total** row at the bottom covers every row of the tab, not only the page you are on or the search. Its **Certified** total equals the **Certifications** card, and its **Completed** total equals the **Trainings completed** card, for the same time range and filters. **People** in the **Total** row counts each person once, so it is not the sum of the rows. The line under the **Total** row explains why a tab's **In progress** total can differ from the **Courses in progress** card.

The table shows 10 rows at a time. Use the page controls at the bottom to see the rest.

## How do I see the people behind a number?

Select a **Certified**, **Completed** or **In progress** number in the table to open the people behind it.

1. Select the number in a row. A panel opens, headed with the status and the tab, such as **Certified — certifications**, and with the row and its count of person-course pairs under it.
2. Type in **Search people...** to find a person by name.
3. Select a person's name to open their details.

The number counts person-course pairs in the time range, while the panel names current employees only, so the list can be shorter than the number. The panel lists up to 500 people, and then says **Showing the first 500 current employees.**

## How do I filter Training & Certification?

You filter the page with the bar above the table. The time range and the filters change both the cards, except **Training-program roster members**, and the table. The name search changes the table only.

1. Type in **Search by name** to narrow the table to the rows whose name matches, such as a course or foundation name. It searches the rows, not people.
2. Select a time range: **Past 30 days**, **Past 90 days**, **Past 365 days**, **Past 2 years** or **All time**. **Past 2 years** is the default.
3. Select what to group the table by: **Course** (the default), **Foundation**, **Project**, **Level** or **Format**.
4. Select **More filters** to show **Foundation**, **Project**, **Course**, **Level** and **Format**. Each starts on **All Foundations**, **All Projects**, **All Courses**, **All Levels** or **All Formats**. The link counts how many of them are set, such as **More filters (1)**.
5. Select **Clear all** to reset the five filters under **More filters**, and the **Company** filter when a company family is selected. It keeps the time range, **Group by**, the tab and the search.

The filter menus offer the values found for the company in the selected time range. A value you picked that has no rows in the new range stays applied and is shown as **(no rows in range)**. If the menus cannot load, the page says **Couldn't load the filter options. Your selections still apply.** and offers **Retry**.

When you switch to another company, the five filters under **More filters** and the search are cleared. The time range and **Group by** stay.

## What does the Training & Certification page show for a company family?

For a company family, the Training & Certification page combines the training of every company in that family that you have access to. You pick a family in the company selector, where it is listed as **All**, the family's name and **Companies** (for example, **All Acme Companies**). The page heading then reads **Training & Certifications — All Acme Companies**, and the line under it is **Training enrollments and certifications across your companies.**

For a company family, the cards count across the whole family. **Training-program roster members** adds up the companies' counts, and the other cards count each person and each person-course pair once:

- **People with training activity**, **Certified people** and **People in training** count a person once, even when more than one of the family's companies lists them. **People in training** counts people with a course that has no certificate under any of the companies.
- **Courses taken**, **Certifications** and **Trainings completed** count each person-course pair once. A pair with a certificate under any of the family's companies counts as certified.
- **Courses in progress** is **Courses taken** minus the pairs with a certificate, so a course that a person finished under one company is not also counted as in progress.
- **Learners not on the people list** counts only learners who are on none of the family's companies' people lists.
- **Training-program roster members** adds up each company's count, so a person on two companies' rosters counts twice. It says **No LF Education training program on record for this company** only when none of the companies it counts has a program.

For a company family, the table lists each company's rows separately, and a **Company** filter narrows the page to one company:

- The table has one row per **Group by** value and company, such as one row for each course and company, with a **Company** column after the grouped column. Each row counts that company's own people and person-course pairs, so a person in two companies appears in both companies' rows. A course a person finished under one company can show as **In progress** in another company's row.
- The **Total** row counts each person and each person-course pair once across the family, so it can be less than the sum of the rows. Its **Certified** and **Completed** totals still equal the **Certifications** and **Trainings completed** cards. The line under the **Total** row says **A person in more than one company is counted once in the totals.**
- A **Company** filter, next to the search, narrows the cards and the table to one company of the family. It starts on **All Companies**. It is kept in the page address (`?company=`), and **Clear all** resets it as well as the five filters under **More filters**. A company that is not in the family is removed from the address, and the page shows every company.
- The menus under **More filters** offer the values found for any company in the family, whichever company the **Company** filter is set to.
- Selecting a **Certified**, **Completed** or **In progress** number opens that row's company only: the line under the panel heading names the company, and the panel lists that company's current employees. Selecting a person's name opens their details for that company.

If some of the family's companies are left out, a notice under the page heading says so. It reads **Some companies in this family are not included because you do not have access to them.** when you cannot open some of them, and **This family's companies could not all be loaded, so these figures may be incomplete.** when they could not all be loaded.

## Why is the Training & Certification table empty, or why did it fail to load?

A table that finds no rows says so, and a table that fails to load offers **Retry**. An empty table is not the same as a failed load.

| What you see                                                                   | What it means                                      | What to do                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------ |
| **No certifications for these filters**, or **No trainings for these filters** | No rows for the time range and filters on that tab | Widen the time range or change the filters |
| **No certifications match your search**, or **No trainings match your search** | The search matches no row                          | Change or clear the search                 |
| **Couldn't load certifications**, or **Couldn't load trainings**               | The table did not load                             | Select **Retry**                           |
| **Couldn't load training stats**                                               | The cards did not load                             | Select **Retry**                           |

An empty table also shows **Browse courses**, which opens the Linux Foundation training course catalog.

## Related sections

- [People](../people/) — the **Trainees** tab lists each trainee, with the same cards and filters
- [Company Overview dashboard](../company-overview/) — the **People with training activity**, **Certified people** and **Courses taken** Education tiles, which open this page
- [Choose and switch a company](../choose-a-company/) — pick the company the page shows
- [Company FAQ](../faq/) — short answers about the Company lens
