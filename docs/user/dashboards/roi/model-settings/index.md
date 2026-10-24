---
title: Model settings and defaults
description: The default settings of the ROI model — observation window, cost rates, overhead, markup distribution, and estimation thresholds.
audience: [all]
product_area: Dashboards
tags: [roi, parameters, defaults, settings, assumptions]
last_updated: 2026-10-16
intercom_collection: Dashboards
---

These are the fixed settings the ROI model currently runs with. They apply identically to every organization, and the ROI page cannot recalculate figures with different values. They are listed so you can see exactly what each assumption is.

## Observation window

| Setting    | Default                 | Effect                                                            |
| ---------- | ----------------------- | ----------------------------------------------------------------- |
| Start date | 2010-01-01              | Inclusive start of the window. The first year is derived from it. |
| End date   | Start of the next month | Exclusive end of the window, so the current month is included.    |

## Contribution costs

| Setting            | Default  | Effect                                                                                         |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------- |
| Code salary        | $200,000 | USD per FTE-year, code price                                                                   |
| Community salary   | $150,000 | USD per FTE-year, community price                                                              |
| Meetings salary    | $200,000 | USD per FTE-year, meetings price                                                               |
| Event overhead     | $3,000   | USD per attendee added to the average ticket price                                             |
| Hours scenario     | Medium   | Which estimate (low, medium, high) from [Activity time costs](../activity-time-costs/) is used |
| Code overhead      | 1.5      | Multiplier on code FTE                                                                         |
| Community overhead | 1.5      | Multiplier on community FTE                                                                    |
| Meetings overhead  | 1.5      | Multiplier on meetings FTE                                                                     |

## Markup estimation (stage 1)

| Setting                                | Default | Effect                                                               |
| -------------------------------------- | ------- | -------------------------------------------------------------------- |
| Markup distribution mean               | 3.0     | Target mean of the shifted-gamma markup distribution (must exceed 1) |
| Markup distribution standard deviation | 2.0     | Target standard deviation of that distribution                       |
| Minimum months                         | 3       | Minimum months of data for a pair to receive a markup                |

## CES estimation (stage 2)

| Setting                 | Default                  | Effect                                                                                             |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| Fallback `σ`            | 0.5                      | Elasticity used when it cannot be identified                                                       |
| Minimum complete years  | 2                        | Complete years required for panel estimation. Also used in inference when choosing period averages |
| Feasible range for `σ`  | [0.1, 0.99] ∪ [1.01, 10] | Search range. `σ = 1` is excluded because the CES form is degenerate there                         |
| Prior: maximum residual | 1.0                      | Maximum mean moment residual for a pair to enter the `σ` prior                                     |
| Prior: minimum pairs    | 10                       | Minimum well-identified pairs needed to form the prior                                             |

## Related reading

- [Contribution labor](../contribution-labor/)
- [Stage 1: markups](../stage-1-markups/)
- [Stage 2: CES allocation](../stage-2-ces/)
