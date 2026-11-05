---
title: Model settings and defaults
description: The default settings of the ROI model — observation window, cost rates, overhead, markup distribution, and estimation thresholds.
audience: [all]
product_area: Dashboards
display_order: 14
tags: [roi, parameters, defaults, settings, assumptions]
last_updated: 2026-11-05
intercom_collection: Dashboards
---

These are the fixed settings the ROI model currently runs with. They apply identically to every company, and the ROI page cannot recalculate figures with different values. They are listed so you can see exactly what each assumption is.

## Observation window

| Setting    | Default                 | Effect                                                            |
| ---------- | ----------------------- | ----------------------------------------------------------------- |
| Start date | 2010-01-01              | Inclusive start of the window. The first year is derived from it. |
| End date   | Start of the next month | Exclusive end of the window, so the current month is included.    |

## Contribution costs

| Setting            | Default  | Effect                                                                                                          |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------- |
| Code salary        | $200,000 | USD per FTE-year, code price                                                                                    |
| Community salary   | $150,000 | USD per FTE-year, community price                                                                               |
| Meetings salary    | $200,000 | USD per FTE-year, meetings price                                                                                |
| Event overhead     | $3,000   | USD per attendee added to the average ticket price                                                              |
| Hours scenario     | Medium   | Which estimate (low, medium, high) from [Hours per activity](../contribution-labor/#hours-per-activity) is used |
| Code overhead      | 1.5      | Multiplier on code FTE                                                                                          |
| Community overhead | 1.5      | Multiplier on community FTE                                                                                     |
| Meetings overhead  | 1.5      | Multiplier on meetings FTE                                                                                      |

## Estimation method shown on the page

| Setting       | Default  | Effect                                                                                                                                                    |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markup method | Logistic | Choose Logistic or Direct in **Model assumptions** on the ROI page. The choice applies to every figure on the page and is remembered on your device only. |

## Markup estimation (stage 1)

| Setting                                | Default  | Effect                                                                                                                                |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Markup distribution mean               | 6.0      | Target mean of the shifted-gamma markup distribution (must exceed 1)                                                                  |
| Markup distribution standard deviation | 3.162278 | Target standard deviation of that distribution (the square root of 10)                                                                |
| Minimum months                         | 3        | Minimum months of data for a pair to receive a markup. Also the minimum number of active months a pair needs to enter the first stage |

With this mean and standard deviation, the shifted gamma distribution that [stage 1](../stage-1-markups/#from-utility-to-markup) maps ranks onto has shape `a = 2.5` and scale `θ = 2`, so markups start at 1, the most common value is 4, and the mean is 6. This is the only page that states the calibration values. Other pages link here.

## CES estimation (stage 2)

| Setting                 | Default                  | Effect                                                                     |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------- |
| Fallback `σ`            | 0.5                      | Elasticity used when it cannot be identified                               |
| Minimum complete years  | 2                        | Complete years required for panel estimation                               |
| Feasible range for `σ`  | [0.1, 0.99] ∪ [1.01, 10] | Search range. `σ = 1` is excluded because the CES form is degenerate there |
| Prior: maximum residual | 1.0                      | Maximum mean moment residual for a pair to enter the `σ` prior             |
| Prior: minimum pairs    | 10                       | Minimum well-identified pairs needed to form the prior                     |

## Display gate

| Setting                              | Default | Effect                                                                      |
| ------------------------------------ | ------- | --------------------------------------------------------------------------- |
| Minimum total spending               | $5,000  | Total spending, summed over a company's projects, needed for it to be shown |
| Minimum total active months          | 12      | Active months, summed over a company's projects, needed for it to be shown  |
| Minimum active months in one project | 6       | Active months needed in at least one project for the company to be shown    |

All three must hold. See [Which companies are shown](../interpreting-results/#which-companies-are-shown).

## Related reading

- [Contribution labor and time costs](../contribution-labor/)
- [Stage 1: markups](../stage-1-markups/)
- [Stage 2: CES allocation](../stage-2-ces/)
- [Methodology decisions](../methodology-decisions/) — why the model makes these choices
- [ROI documentation](../)
