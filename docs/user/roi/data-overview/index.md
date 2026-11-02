---
title: ROI data overview
description: The data behind the ROI model — contribution types, sources, how each is priced, the observation window, and the known limitations.
audience: [all]
product_area: Dashboards
tags: [roi, data, contribution types, sources, observation window, limitations]
last_updated: 2026-10-30
intercom_collection: Dashboards
---

The model needs two kinds of data:

1. **How often** an organization contributes to a project. This is used to infer how much value the organization perceives.
2. **How much** it invests, in units and dollars. This is used to value contributions and to compute ROI.

This page lists the sources and how each is used. Detail on the conversions is in [Contribution labor](../contribution-labor/) and [Financial expenditures](../financial-expenditures/).

```text
Sources                            Processed datasets                Used for
────────────────────────────       ───────────────────────────       ─────────────────────────
Activity records, meetings,        Contribution frequency            Stage 1: markups
event registrations, sponsor-      (monthly yes/no per pair)
ships, memberships, courses        Contribution levels               Stage 2: allocation, and
                                   (yearly quantity and price        inference (value, ROI)
                                   per type)
```

## Unit of analysis

Everything is indexed by:

- **Organization** (written _i_ in the technical pages)
- **Project** (_j_)
- **Time** (_t_): months for participation, calendar years for contribution levels
- **Contribution type** (_k_)

The universe is member organizations that have an LF account mapped to them and are affiliated with a project. Expenditure data is only available for these organizations.

## Contribution types and sources

| Type                        | Source                  | Quantity                           | Price                                        | Fixed unit? |
| --------------------------- | ----------------------- | ---------------------------------- | -------------------------------------------- | ----------- |
| Code                        | LFX Insights activities | FTE from activity counts and hours | Code salary                                  | No          |
| Community                   | LFX Insights activities | FTE from activity counts and hours | Community salary                             | No          |
| Meetings                    | Meeting attendance      | FTE from attended hours            | Meeting salary                               | No          |
| Event attendance            | Event registrations     | Number of paid registrations       | Average net ticket price plus event overhead | No          |
| Event sponsorship           | Event sponsorships      | 1                                  | Total sponsorship                            | Yes         |
| Project membership          | Memberships             | 1                                  | Pro-rated annual fee                         | Yes         |
| Linux Foundation membership | Memberships             | 1                                  | Fee split across key projects                | Yes         |
| Education courses           | Course purchases        | Units sold                         | Median net revenue per unit                  | No          |

Expenditure for a type in a year is **quantity × price**. For fixed-unit types the quantity is always 1, so the price carries the dollar amount. The model treats these types differently in estimation. See [Stage 2: CES allocation](../stage-2-ces/).

## How the data is used

| Dataset                      | Used for                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| Contribution frequency       | Stage 1: a monthly yes/no participation record per organization-project pair, which drives the markups |
| Contribution levels          | Stage 2 and inference: yearly quantity and price per contribution type                                 |
| Markup distribution settings | Calibration of markups, anchored to the LF Research Open Source ROI Survey                             |

## Contribution frequency (stage 1 input)

A monthly record with an active flag for each organization-project pair:

- A month is **active** if the organization had any code or community activity on the project in that month. Code and community activity are pooled. Meetings, events, memberships, and courses do not count toward the flag.
- A pair is included if it has at least one active month on or after the project's start date. The record starts at the later of the model's start date and the project start date and runs to the end of the observation window. Projects with no start date are dropped.
- Each month also carries the **previous month's** active flag.
- The stage 1 participation model uses organization and project effects, the previous month's active flag (to control for past activity), and the pair's investment scale and observation window (so that team size and project age are not mistaken for perceived value). See [Stage 1: markups](../stage-1-markups/).

## Contribution levels (stage 2 and inference input)

One record per organization, project, year, and type, restricted to records where quantity and price are positive. Records are kept only between a pair's first and last year with any contribution of any type, and within the observation window. A year in which a type has no activity simply has no record for that type, which matters for how complete years are defined in estimation.

## Counting each resource once

Summing any breakdown of an organization's investment must never count the same resource twice. Three rules guarantee this.

1. **A unit of work is credited to one project.** An activity is credited to the project it was recorded against and is not fanned out to parent projects. The same contribution can still be recorded once per project, repository, and integration that ingested it. For example, Linux kernel history imported through a fork would make the fork look larger than the kernel. The model keeps one copy per contribution, preferring the upstream repository over a known fork. See [Contribution labor](../contribution-labor/#which-activities-count).
2. **Money is credited to the project that sold it, over its real term.** Memberships are spread across the years of their real term. Event registrations, sponsorships, and meetings are recorded once, against the project that owns them. See [Financial expenditures](../financial-expenditures/).
3. **Foundations keep their own spend and do not roll up children.** A foundation pair holds the foundation's own events, membership, and foundation-level repositories. Its sub-projects are separate pairs, so summing an organization's projects gives a true total.

Placeholder organizations such as "Individual - No Account", "Self-Employed", and "Unknown" pool unrelated people and are not organizations. They are excluded from estimation and results.

## Observation window

The window starts on 2010-01-01 and ends at the start of the next month, so it always reaches the current month. Due to data availability, meeting attendance is limited to the last 24 months.

## Calibration data

The target distribution of markups (see [Model settings and defaults](../model-settings/#markup-estimation-stage-1) for its mean and standard deviation) is set to be consistent with the [LF Research Open Source ROI Survey](https://www.linuxfoundation.org/research/contribution-roi). It is a configuration input of the model, not data observed for each organization.

## Known limitations

- Hours per activity are domain-knowledge estimates, not measurements ([details](../activity-time-costs/)).
- Salaries and overhead multipliers are flat parameters, not organization-specific.
- Event currency conversion uses a fixed exchange-rate table. Registrations in other currencies are dropped.
- The cost of a Linux Foundation membership is distributed evenly across an organization's key projects.
- Meeting costs are attributed to the project where the meeting occurred, with no fan-out to parent projects.
- Only member organizations with a mapped LF account are covered for expenditure data.

## Related reading

- [Contribution labor](../contribution-labor/)
- [Financial expenditures](../financial-expenditures/)
- [Activity time costs](../activity-time-costs/)
- [The model (technical)](../model/)
