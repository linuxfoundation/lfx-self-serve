---
title: Contribution labor
description: How the ROI model turns activity counts and meeting attendance into full-time-equivalent effort and a dollar cost, using opportunity cost as the yardstick.
audience: [all]
product_area: Dashboards
tags: [roi, labor, fte, salary, overhead, opportunity cost, activity]
last_updated: 2026-10-30
intercom_collection: Dashboards
---

Some contribution cannot be read off an invoice. What is a commit, a bug report, or an hour in a steering committee worth to an organization? The model values labor by its **opportunity cost**: staff who contribute could have been doing other work, so the cost of their time is a common yardstick across contribution types and organizations.

## From activity to dollars

For each organization, project, and year:

1. Count activity events by type, separately for code and community activity.
2. Multiply each count by the estimated hours for that activity type.
3. Convert hours to full-time-equivalent (FTE) effort and apply an overhead multiplier.
4. Value each FTE at a standard annual salary.

```text
FTE(i,j,t,k)  =  [ Σ_a  n(i,j,t,a) × h(a) ] / 2080  ×  o(k)
Cost(i,j,t,k) =  FTE(i,j,t,k) × w(k)
```

where, for organization _i_, project _j_, year _t_, and labor type _k_:

- `n(i,j,t,a)` is the number of events of activity type _a_
- `h(a)` is the estimated hours for one event of that activity type
- `2080` is the number of working hours in a year (52 weeks × 40 hours)
- `o(k)` is the overhead multiplier
- `w(k)` is the annual salary for that type

The multiplier is applied to the **quantity** (FTE), not the price, so the salary stays interpretable as a benchmark. The salaries are flat benchmark constants, the same for every organization. They are not derived from anyone's actual or reported compensation.

| Type      | Hours from                        | Overhead | Salary (USD per FTE-year) |
| --------- | --------------------------------- | -------- | ------------------------- |
| Code      | Activity counts × estimated hours | 1.5      | 200,000                   |
| Community | Activity counts × estimated hours | 1.5      | 150,000                   |
| Meetings  | Attended meeting minutes ÷ 60     | 1.5      | 200,000                   |

These are the current defaults. See [Model settings and defaults](../model-settings/).

## Which activities count

Activity comes from LFX Insights:

- Bot members are excluded.
- Each contribution is counted once. The same contribution can be recorded several times, once for every project, repository, and integration that ingested it. A commit copied into a fork or mirror keeps its identity, for example. Only one copy is kept for each contribution (identified by the commit, else the source record, plus the activity type and the contributor). The copy from the upstream repository wins over a copy from a known fork. See [Counting each resource once](../data-overview/#counting-each-resource-once).
- Each activity is credited to the one project it was recorded against. It is not fanned out to parent projects or foundations.
- Placeholder organizations such as "Individual - No Account" or "Self-Employed" are excluded, because they pool unrelated people.
- **Code:** activities flagged as code contribution.
- **Community:** all other activities except passive signals: stars, unstars, forks, and members joining or leaving.
- Only activity within the [observation window](../data-overview/#observation-window) is used.

Meetings come from LFX meeting attendance: attended invitations, excluding individual (non-organization) accounts, limited to the last 24 months, with the duration in minutes converted to hours. Meeting hours are credited to the project where the meeting took place.

## Hours per activity

Each activity type carries an estimated number of hours. These are **domain-knowledge estimates of the marginal focused effort for one event**, not measurements. They come in three scenarios, low, medium, and high, and the model uses medium.

- A chat message is seconds to minutes. Opening a pull request is hours.
- Authoring ranks above reviewing, which ranks above triage and commenting, then administrative events, then passive signals.
- Activity types with no estimate receive zero hours and drop out of the FTE total.

The full table, with the reasoning for each estimate and the lowest-confidence entries, is in [Activity time costs](../activity-time-costs/).

## Why not COCOMO

COCOMO-style methods price the _software produced_, from lines of code. This model prices the _resources an organization puts in_. That covers more than code (reviews, discussions, meetings), and it follows from economic reasoning about opportunity cost instead of a conversion factor from code size to effort.

## Sensitivity

Changing the hours scenario, salaries, or overhead multipliers changes the quantity or price of the labor types. That changes investment directly, and it also changes the allocation estimates and the estimated value. Because every organization is priced with the same rates, relative comparisons between organizations are more robust than the absolute dollar levels.

## Related reading

- [Activity time costs](../activity-time-costs/)
- [Financial expenditures](../financial-expenditures/)
- [Data overview](../data-overview/)
