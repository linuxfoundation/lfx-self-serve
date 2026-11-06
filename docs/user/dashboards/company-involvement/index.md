---
title: Company involvement in a foundation
description: What the Involvement section of the Foundation lens overview shows about a company in the selected foundation — the Membership Tier card, the six metric cards, the detail panel each card opens, and what the section's messages mean.
audience: [all]
product_area: Dashboards
tags: [dashboard, foundation, company, involvement, membership-tier, contributors, maintainers, event-attendees, event-speakers, certifications, training]
last_updated: 2026-11-06
intercom_collection: Dashboards
---

The Involvement section of the Foundation overview shows how one company takes part in the foundation you selected: its membership tier, active contributors, maintainers, event attendees and speakers, certified employees and training enrollments. Selecting any card except **Membership Tier** opens a panel with a chart over time and, for most cards, a breakdown by project or program. The section is headed with the company's name, such as **Acme's Involvement**.

These steps apply to board members and executive directors in the **Foundation** lens. The Company lens has its own Involvement cards, which total all foundations; see [How is this different from the Org Overview?](#how-is-this-different-from-the-company-overview).

## Which company and foundation does the section show?

The section shows the company that is selected for you in LFX Self Serve, the same one the **Company** lens opens, in the foundation you selected in the Foundation lens.

- To see another foundation, select it in the context picker in the top navigation. See [Switch project context](../navigate-dashboards/#switch-project-context).
- To see another company, switch companies in the Company lens, then return to the Foundation lens. See [Choose and switch a company](../../company/choose-a-company/).
- If no company is selected for you, the heading reads **Company's Involvement**, the metric cards show 0 and **Membership Tier** shows **N/A**.

## How do I open the Involvement section?

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Open the **Foundation** lens and select the foundation. See [How do I get access to the Foundation lens?](../faq/#how-do-i-get-access-to-the-foundation-lens).
3. On the Foundation overview, scroll to the heading that names the company, such as **Acme's Involvement**.
4. Use the buttons under the heading to show only one group: **All**, **Contribution**, **Event** or **Education**. **Membership Tier** shows only under **All**.
5. Use the arrow buttons at the right of the heading to scroll through the cards.

## What do the Involvement cards show?

The section has a **Membership Tier** card and six metric cards. Each metric card shows a number, a short line under it, and a small chart over time.

| Card                     | What it shows                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Membership Tier**      | The company's membership in the foundation: **Tier** (or **N/A** when it has none), **Member Since** (month and year) and **Renewal Date**. A dash (**—**) means the date is not known. It does not open a panel |
| **Active Contributors**  | The number of the company's employees contributing to the foundation's projects, with **Employees actively contributing to projects** under it                                                                   |
| **Maintainers**          | The number of the company's employees who maintain the foundation's projects, with **Employees stewarding foundation projects** (or **project**) under it                                                        |
| **Event Attendees**      | The number of the company's employees at the foundation's events, with **Employees at foundation events** under it                                                                                               |
| **Event Speakers**       | The number of the company's employees who spoke at the foundation's events, with **Employee speakers at events** under it                                                                                        |
| **Certified Employees**  | The number of the company's employees with a certification, shown as **N employees**, with the number of certifications under it, such as **12 total certifications**                                            |
| **Training Enrollments** | The company's employees' enrollments in training courses, with **Training courses enrolled this year** under it. Its chart adds the enrollments up day by day                                                    |

## What does each card's panel show?

Selecting a metric card opens a panel on the right. The panel's title is the card's name. Close it with the close icon or by pressing Escape.

| Panel                    | Sections                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Active Contributors**  | **Active Contributors**, a chart of monthly unique contributors from the company across the foundation over the last 12 months, and **Our Company's Top 5 Projects by Contributor Representation**                                                                                                                                                                           |
| **Maintainers**          | **Active Maintainers**, a chart of monthly active maintainers from the company across the foundation; **Our Company's Top 5 Projects by Maintainer Representation**; and **Key Maintainers Representing Our Company**, a list of maintainers with their job title, their projects and the number of projects                                                                 |
| **Event Attendees**      | **Event Attendance**: the number of the company's attendees at foundation events per month, over the last 12 months                                                                                                                                                                                                                                                          |
| **Event Speakers**       | **Foundation Event Speakers from Our Company**: the number of the company's speakers at foundation events per month, over the last 12 months                                                                                                                                                                                                                                 |
| **Certified Employees**  | **Certified Employees**, a running total that adds up, month by month, the employees newly certified in each month, so each point is everyone certified from the first month shown up to that month, not the people who hold a certificate today; and **Certifications by Program**, the number of employees certified in each certification program over the last 12 months |
| **Training Enrollments** | **Training Enrollments**, the employees' training enrollments over the last 12 months, and **Enrollments by Training Project**, how those enrollments split across projects                                                                                                                                                                                                  |

When a part of a panel has nothing to show, it says so for the foundation, such as **No event attendance data available for this foundation.** The panels show the same message when their figures fail to load. If you expected figures, close the panel and open it again.

## What do the messages in the Involvement section mean?

When one of the cards fails to load, the section shows a single message in place of all the cards.

| Message                                                     | What it means and what to do                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Please select a foundation project to view company data** | No foundation is selected. Select one in the context picker in the top navigation                                                     |
| **This section could not be loaded**                        | Something went wrong loading the figures. The rest of the page is unaffected. Select **Retry**                                        |
| **You do not have access to this company**                  | Access to the company's figures is granted by its own Company Lens administrators. Ask them for access, or select **Contact support** |
| **Access could not be verified**                            | Your access could not be checked right now. This is temporary and does not change your permissions. Select **Retry**                  |

## How is this different from the Org Overview?

The Involvement section on the Foundation overview covers one foundation, and every card except **Membership Tier** opens a panel. The [Org Overview](../../company/company-overview/), the Dashboard of the **Company** lens, totals the company's involvement across all Linux Foundation foundations. Its cards count differently, and only its three **Education** cards, **People with training activity**, **Certified people** and **Courses taken**, open another page.

The **Company Dependency** card in the Foundation overview's health metrics is a different card: it shows how concentrated the foundation's contributions are across companies. See [Company Dependency](../foundation-health-metrics/#company-dependency).

## Related

- [Foundation Health Metrics](../foundation-health-metrics/) — the health cards on the Foundation overview, including Company Dependency
- [Navigate Your Dashboard](../navigate-dashboards/) — switch lenses and the foundation you are viewing
- [Org Overview dashboard](../../company/company-overview/) — the company's involvement across all foundations, in the Company lens
- [Company FAQ](../../company/faq/) — short answers about the Company lens
