---
title: ROI metrics
description: How the Org Lens ROI page estimates your organization's investment in Linux Foundation projects and the return associated with it, with guides to the model's intuition, data, and mathematics.
audience: [all]
product_area: Dashboards
tags: [org, org lens, roi, return on investment, investment, return, estimation method, markup]
last_updated: 2026-10-30
intercom_collection: Dashboards
---

The **ROI Metrics** page in Org Lens (route: `/org/roi`) estimates what your organization invests in Linux Foundation projects through its public contribution activity, and the economic return associated with those projects.

The estimates come from the LFX Open Source Software (OSS) Contribution ROI model, which this section documents in full. The model combines contribution data from LFX with a structural economic model, and it estimates the implied return to contribution for every organization-project pair with enough contribution history. This section explains the model at three levels of depth, so you can stop at whichever one answers your question: plain-language guides, the data, and the technical description.

## What the model produces

- **ROI estimates** for every organization-project pair with sufficient contribution history and data
- **Investment**, in dollars, broken down by contribution type (code, community, meetings, events, memberships, and training) and annualized

## What the figures mean

- **Total investment** — your organization's public contribution activity (commits, community participation, meetings, events, memberships, and training), priced at standard rates that are the same for every organization. Direct spending (memberships, event tickets and sponsorships, training) comes from LF records. Staff time is estimated from activity records and priced at flat benchmark rates. No individual's or organization's actual salary or payroll data is used.
- **Total return** — the economic value your organization received back from the projects it contributed to, estimated from the wider project ecosystem rather than measured from your own systems.
- **Net return** — total return less investment. Net return is never negative. When the model's value estimate would fall below investment, it is raised to break-even, so a net return of zero means the project returned at least what it cost.
- **ROI** — net return divided by investment, shown as a percentage. Blank when there is no investment to divide by.
- **BCR** — total return divided by investment (benefit-cost ratio). Note that BCR = ROI + 1.

## Where to start

Pages are ordered from plain-language guides, to the data, to the technical description.

| If you want to...                                             | Read                                                |
| ------------------------------------------------------------- | --------------------------------------------------- |
| Understand the idea behind the model                          | [How the model works](./how-it-works/)              |
| Know what each number means and where it stops being reliable | [Interpreting results](./interpreting-results/)     |
| Get quick answers to common questions                         | [ROI FAQ](./faq/)                                   |
| See what data goes in and how it is priced                    | [Data overview](./data-overview/)                   |
| Understand how staff time becomes dollars                     | [Contribution labor](./contribution-labor/)         |
| See how memberships, events, and training are counted         | [Financial expenditures](./financial-expenditures/) |
| Check the hours assigned to each activity type                | [Activity time costs](./activity-time-costs/)       |
| Read the full mathematical model and its assumptions          | [Technical model description](./model/)             |
| Look up a default setting                                     | [Model settings and defaults](./model-settings/)    |

## Related sections

- [Dashboard](../dashboards/)
- [Organization](../organization/)
