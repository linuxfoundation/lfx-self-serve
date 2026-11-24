---
title: CDP companies
description: Find and open a CDP company — a company seen in open source activity that has no company account — as LF staff, what each of its pages shows, and what the messages on a CDP company address mean.
audience: [all]
product_area: Company
tags: [company, org, org-lens, cdp, search, switcher, lf-staff, participating-companies]
last_updated: 2026-11-24
intercom_collection: Company
---

A CDP company is a company seen in open source activity (code contributions in the projects LFX Insights shows) that has no company account at the Linux Foundation. LF staff can find and open CDP companies in the Company lens. Nobody else sees them: for anyone outside LF staff, a CDP company address reads the same as an address that opens no company.

## How do I find a CDP company?

You find one with the company switcher search, as LF staff.

1. Select **Company** in the lens switcher.
2. Select the company switcher at the top of the sidebar and type at least two letters of the company's name.
3. Companies with a company account are listed first, as they always are. Below them, a **CDP companies** group lists up to 20 CDP companies whose name matches, each tagged **CDP**. The group may show a loading line for a moment after the other results appear. When only CDP companies match, the list above the group says **No companies with a company account found**.
4. Select a CDP company to open its **Dashboard**.

Selecting a CDP company does not change the company you have selected in the switcher. While a CDP company page is open, the switcher card shows that company with the **CDP** tag and no role; when you leave the page, it shows your selected company again. If the group says **CDP search unavailable**, the CDP list could not be read right now or is out of date; try again later. The other results are not affected.

On a Project lens **Participating companies** page, LF staff can also open a CDP company by selecting its name in the list.

## What does a CDP company page show?

A CDP company page lives at `/company/<CDP id>`, where the CDP id is a long identifier of letters, numbers and hyphens. It shows counts only, never the names of the company's people, and it has no edit, invite or settings controls. Its sidebar offers:

- **Dashboard** — the company's contributors and activities over the last 2 years, across every project LFX Insights shows, its last active month and its top project
- **Projects** — the Linux Foundation projects the company contributed to in the last 2 years, with contributors and activities per project
- **Company Profile** — the company's name, logo, top project and last active month
- **Events** — per event, how many of the company's people attended, over the last 5 years
- **Training & Certification** — the company's total training enrollments and certifications issued, over the last 5 years

On **Events** and **Training & Certification**, a number that would describe fewer than 5 people is not shown. Every other Company lens page, EasyCLA included, is greyed in the sidebar with the reason **Not available for CDP companies**.

## What do the messages on a CDP company address mean?

| Message                                                        | What it means                                                                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **No company at this address**                                 | The address opens no CDP company you can see: it is unknown, it is not a CDP id, or CDP companies are not available to you. |
| **No activity in the last 2 years — last active** _month year_ | The company has had no counted activity in the last 2 years, so it shows no figures.                                        |
| **Not enough activity to show — last active** _month year_     | The company has some recent activity, but too little to show its figures.                                                   |
| **Access could not be verified**                               | Whether you can see CDP companies could not be checked right now. Select **Retry**.                                         |

On a company with one of the two activity messages, the sidebar lists no pages: the message is all the page shows.

An old address of a company that was merged into another opens the company it was merged into. An address of a company that now has a company account opens that company's Company lens home, if you can open it.

## Related sections

- [Choose and switch a company](../choose-a-company/) — the company switcher and what a company in a page address means
- [Navigate dashboards](../../dashboards/navigate-dashboards/) — the Project lens **Participating companies** page
