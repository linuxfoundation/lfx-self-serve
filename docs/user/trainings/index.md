---
title: Training & Certifications
description: View your Linux Foundation training enrollments and certifications in LFX Self Serve.
audience: [all]
product_area: Trainings
tags: [trainings, courses, enrollments, certifications, learning]
last_updated: 2026-11-06
intercom_collection: Trainings
---

The Training & Certifications section shows your Linux Foundation training enrollments and certifications. Training programs are offered through the Linux Foundation's learning platform and help you develop skills recognized by the open-source community.

## Your personal training activity

The information below reflects **your** training enrollments and certifications — the courses you have completed or are enrolled in as the logged-in user.

### What you can do

- View your enrolled training courses and certification exams
- Check your enrollment and completion status
- Access your earned certifications and [rewards, incentives, and coupons](rewards/)

Training enrollment is handled on the Linux Foundation training platform. LFX Self Serve displays your enrolled courses and certifications in read-only view. Use the **LF Training Portal** link in the Useful links section (right sidebar) to access your courses.

### Who this applies to

All authenticated users can view their training enrollments.

### Navigation

Go to **app.lfx.dev** and select **Training & Certifications** from the left navigation sidebar (route: `/me/training`). The page shows tabs for Certifications, Enrolled Trainings, and Rewards, plus a **Useful links** section in the right sidebar.

### Relationship to badges

Completing certain training programs qualifies you for LFX badges. After you complete a qualifying course, the badge appears automatically in your [Badges](../badges/) section.

## Your company's activity

The **Training & Certification** page in Company Lens (route: `/org/training`) gives you visibility into training and certification activity across your company. Rather than showing your individual enrollments, this view aggregates data for all members associated with your company.

### What you can see

- Training enrollments and completions across your company's members
- Certification achievements earned by people affiliated with your company
- An overview of your company's investment in Linux Foundation learning programs

### Overview Education tiles

On the Org Overview, the three Education tiles (**People with training activity**, **Certified people** and **Courses taken**) show the same numbers as the Training & Certification page when it opens with its defaults (Past 2 years, no filters), with their unit, window and as-of date. The tiles show only that headline and its sub-line; they have no chart. Select a tile to open that page.

### Time range, filters and group by

The Training & Certification page and People › Trainees share one filter bar and one set of definitions, so for the same selections the cards at the top show the same figures. The Trainees cards also count former employees who are still on the people list, which the table does not list (see People › Trainees). Both start on **Past 2 years**. On Training & Certification the bar sits in the card above the table, on one row with the name search; on People › Trainees it sits in its own card above the numbers.

Search, **Time range** and (on Training & Certification) **Group by** are always visible. Foundation, Project, Course, Level and Format are behind **More filters**; the link reads **More filters (2)** when two of them are set, so a filter from a shared link is never hidden. **Fewer filters** collapses them again. Whether the row is open applies to the visit only, while the filter values stay in the page address.

- **Time range** — Past 30 days, Past 90 days, Past 365 days, Past 2 years (default) or All time. It applies to every number and table on the page, and it is kept in the page address (`?range=`), so a link or a reload shows the same view.
- **Filters** — Foundation, Project, Course, Level and Format. They narrow the numbers and the table together. Certificates carry the course's format, like enrollments. A course counts under the foundation, project, level and format it has across all of its rows in the range, so a filter keeps or drops a whole course, never a single enrollment or certificate of it. **Clear all** resets the five filters and keeps the time range and group by.
- **Group by** (Training & Certification only) — Course (default), Foundation, Project, Level or Format. It changes how the table below is grouped and never changes the numbers at the top.

The 12-month enrollment window that earlier versions of this page applied no longer applies here: the time range replaces it. A person's detail panel and an expanded row on People › All Employees keep their own 12-month rule, stated next to them.

### Numbers at the top of the page

Three numbers show first, **People with training activity**, **Courses taken** and **Certified people**; select **Show 7 more stats** for the rest and **Show fewer stats** to hide them again. Every number states what it counts (people or person-course pairs), its window and the date of the data it reflects ("as of"), and its tooltip gives the full definition. They follow the time range and the filters, except the roster:

- **Training-program roster members** — everyone LF Education's training program lists for your company today, including people who never enrolled in a course. It is live and **does not follow the time range or the filters**, and says so. Shows "—" and "No LF Education training program on record" when your company has no training program.
- **People with training activity** — distinct people on your company's people list with at least one enrollment or certificate in the range. Learners who are not on the people list are not counted here, and it is not a subset of the roster members. With the default time range and no filters, it equals the **Trainees** card on People › All Employees for the same time range, which counts current employees, plus any former employees still on the people list with training in that range. The note under the Trainees cards gives how many former employees that is.
- **Learners not on the people list** — distinct people linked to your company who are not on its people list and have an enrollment or certificate in the range. Shown as a dash (**—**) and not counted while a foundation, project, course, level or format is selected, like their list. They are not part of any people-list number, so they never add to **People with training activity**.
- **Courses taken** — person-course pairs on your company's people list in the range. A course a person took more than once counts once. Courses taken = **Certifications** + **Trainings completed** + **Courses in progress**.
- **Certifications** — pairs of certification products that ended in a certificate in the range. **Certified people** counts the distinct people behind them.
- **Trainings completed** — pairs of training products that ended in a certificate in the range.
- **Completion rate** — (Certifications + Trainings completed) ÷ Courses taken.
- **Courses in progress** and **People in training** — enrolled in the selected range with no certificate in the range. This is not a snapshot of today: an enrollment from before the range, or one since abandoned, is judged by the range alone. Each tile states this rule.

### Certifications and Trainings tabs

The two tabs split the same table by product type. **Certifications** lists certification products; **Trainings** lists everything else. Each row shows the group, **People**, **Courses taken**, **Certified** (Certifications tab) or **Completed** (Trainings tab), and **In progress**.

- The **Total** row at the bottom covers every row of the tab, not only the page or the search, and matches its tile only for the headline count: on the Certifications tab Certified equals the **Certifications** tile, on the Trainings tab Completed equals the **Trainings completed** tile. **In progress** and **People** can differ from the tiles (see the line under the totals). People in the total is distinct people, not the sum of the rows.
- The search box in the filter row narrows the rows only. It never changes the numbers at the top.
- A note under the card states what Certified, Completed and In progress count in the selected range.
- Under the totals row, a line states which products the tab counts: the Certifications tab counts Certification products only and the Trainings tab counts all the others, so each tab's **In progress** total can differ from the **Courses in progress** tile, and the two tabs add up to the tile.
- Sorting and paging happen on the full result, not only on the rows shown.
- Switching tabs keeps the time range, filters and group by.
- Select a **Certified**, **Completed** or **In progress** count to open the list of people behind it. The count is person-course pairs, and the list shows **current employees only**, so it can be shorter than the count.

### People › Trainees

People › Trainees lists the people on your company's people list with training activity in the selected time range, ten to a page by default (the page-size menu offers 10, 25 or 50, and the footer reads, for example, "Showing 1 to 10 of 42"), using the same filter bar (without Group by) and the same numbers as above. Search by name or title. It narrows the table (by name or title) and the list of learners not on the people list (by name), never the cards. The cards at the top follow the time range and the filters, and state the date of the data. Only three cards show at first, **People with training activity**, **Courses taken** and **Certified people**, the ones about the people the table lists: select **Show 7 more stats** for the rest, and **Show fewer stats** to hide them again. The values are the same either way.

Former employees who are still on the people list count in the cards but are not rows of the table, which lists current employees only. When there are any, a note under the cards gives their number, for example "2 former employees on the people list also count in these numbers; the table lists current employees only."

Learners linked to your company who are not on its people list appear in a separate list below the table, **Learners not on the people list**, with their name and one overall status for the time range, paged the same way: **Certified** if they earned a certificate in the range, **Enrolled** otherwise. No course, project or date is shown for them. The list is closed at first, with its count in the header; select the header to open it. A note in the open list says that one person can appear more than once, for example with several training accounts under different emails, and that an org admin can review it if a name looks familiar. The list follows the time range and the name search only, so it is hidden while a foundation, project, course, level or format is selected.

### Navigation

Switch to the **Org** lens from the lens selector at the top of LFX Self Serve, then select **Training & Certification** from the left navigation sidebar (route: `/org/training`).

### Who can access this

Viewing your company's training activity in Company Lens (Training & Certification and People › Trainees) requires **Viewer** access (read access) to your company; an **Admin** can see it too. If you do not have access yet, an admin at your company can invite you from the **Company Lens Access** tab (see [Manage Company Lens Access](../company/manage-company-lens-access/)). Admin access is needed only to manage who has access.

## Related sections

- [Training Rewards and Coupons](rewards/) — view reward points, claim incentives, and redeem coupons
- [Get Help with Training and Certifications](training-support/) — where to get help with exams, vouchers, refunds, and invoices
- [Badges](../badges/) — credentials earned from completed training programs
- [Transactions](../account/transactions/) — training purchases appear in your transaction history
