---
title: ROI metrics
description: How the Org Lens ROI page estimates your organization's investment in Linux Foundation projects and the return associated with it, with guides to the model's intuition, data, and mathematics.
audience: [all]
product_area: Dashboards
tags: [org, org lens, roi, return on investment, investment, return, estimation method, markup]
last_updated: 2026-11-02
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

## Value drivers

The **Projects** panel on the ROI Metrics page has a **Value drivers** tab. It shows how much each value driver contributes to your portfolio's return, relative to the typical organization-project pair.

### What a bar means

- The middle line, labelled **Typical**, is the typical organization-project pair: the average across all pairs LFX models.
- A bar to the right (green) means that driver contributes **more return** to your portfolio than it does for a typical pair. A bar to the left (amber) means it contributes **less**.
- A bar of +14% means 14% more return than typical from that driver. A bar of -5% means 5% less.
- A bar at 0 means your portfolio is typical for that driver. It does not mean the driver provides no value.
- The bars are percentages relative to typical. They do not add up to your total return.

### The five categories

| Category            | Measured from                                                    |
| ------------------- | ---------------------------------------------------------------- |
| Revenue boosters    | Developer productivity and standardization leadership            |
| Strategic           | Talent acquisition and development, and competitive intelligence |
| Prosocial           | Ecosystem goodwill                                               |
| Risk mitigation     | Technical debt reduction and project longevity                   |
| Direct cost savings | Shared R&D                                                       |

Each driver is measured through signals in public LFX contribution data, such as contributor and maintainer counts, how much of your work is shared with other organizations, and governance engagement.

### How far to trust it

- **Association, not cause.** The bars show activity that tends to go with higher or lower return. They do not show that the activity causes it, and they are not based on anything your organization reported.
- **Part of the picture.** The model explains only part of the variation in return. The bars show that explained part.
- **Small portfolios.** Value driver decomposition can be sensitive to small portfolios. Treat these results as directional. The tab appears only for organizations with at least 5 projects that also pass the ROI display gate. Others see an empty state.
- **Risk mitigation** partly reflects project maturity: mature projects carry a longevity premium that applies to every organization contributing to them.
- **Direct cost savings** is measured by a single driver, shared R&D, and can differ noticeably between the two estimation methods. The other categories mostly agree.

The tab covers your whole portfolio and ignores the project picker. It follows the estimation method you choose in **Model assumptions**.

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
