---
title: Interpreting ROI results
description: What investment, contribution value, net value, ROI, BCR, and markup mean on the ROI Metrics page, how to read them, and where the estimates have limits.
audience: [all]
product_area: Dashboards
tags: [roi, bcr, markup, break-even, interpretation, investment]
last_updated: 2026-10-16
intercom_collection: Dashboards
---

The model produces one result for each organization-project pair, for each markup method (see [below](#things-to-keep-in-mind)), plus a yearly breakdown of the same figures.

## The main numbers

| Metric                     | Plain meaning                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Investment                 | Everything the organization spent on the project: direct fees plus the cost of staff time |
| Contribution value         | Estimated value the organization receives                                                 |
| Net value                  | Value minus investment                                                                    |
| ROI (return on investment) | Net value as a share of investment: `(value − investment) / investment`                   |
| BCR (benefit-cost ratio)   | Value per dollar invested: `value / investment`                                           |
| Markup                     | Value the organization perceives per dollar of direct cost                                |
| Break-even markup          | The markup at which value would exactly equal investment                                  |

**Note:** ROI and BCR carry the same information: `BCR = ROI + 1`.

## Reading them

- **ROI of 0.5** means each dollar invested is estimated to return a dollar and a half. Net gain is 50 cents per dollar.
- **ROI of 0** (BCR of 1) is break-even.
- **Negative ROI** means estimated value is below investment for that pair. This can happen because the markup is calibrated across the whole population, so some pairs fall below break-even given their cost mix.
- **Break-even markup** shows how much perceived value per dollar would be needed to justify the investment. A pair with a high break-even markup is expensive relative to the value the behavior suggests.

## Things to keep in mind

- **Investment is estimated.** Staff time is derived from activity counts and [estimated hours per activity](../activity-time-costs/), multiplied by standard salaries and overhead. It is a consistent yardstick, not a payroll record.
- **Only observed activity counts.** Private work, work not tied to a recorded project, and activity LFX cannot attribute to an organization are not captured.
- **Value is inferred, not observed.** It reflects behavior plus a calibrated distribution, not a measured benefit.
- **ROI is not a recommendation.** Projects are complements as well as alternatives, so pair-level numbers should not be used to pick a single "best" project.
- **Two markup methods.** Results are available for two ways of ranking pairs (logistic and direct). See [Stage 1: markups](../stage-1-markups/). They differ in how behavior is converted to a ranking and usually agree on the broad picture.
- **Yearly figures are an allocation.** Annual value and profit are the total split by each year's share of spend. They do not independently estimate value per year. See [Annualization](../inference/#annualization).
- **Value and investment can cover different spans.** For most pairs, value is computed on a per-average-year scale while investment is a total across all years. Compare ROI across pairs with different numbers of active years with care. See [Scale of value versus investment](../inference/#scale-of-value-versus-investment).

## Related reading

- [How the model works](../how-it-works/)
- [ROI FAQ](../faq/)
- [Inference (technical)](../inference/)
