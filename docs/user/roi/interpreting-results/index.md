---
title: Interpreting ROI results
description: What Total Investment, Total Return, Net Return, ROI, and BCR mean on the ROI Metrics page, how the underlying markup relates to them, and where the estimates have limits.
audience: [all]
product_area: Dashboards
tags: [roi, bcr, markup, break-even, interpretation, investment]
last_updated: 2026-10-30
intercom_collection: Dashboards
---

The model produces one result for each organization-project pair, for each markup method (see [below](#things-to-keep-in-mind)), plus a yearly breakdown of the same figures.

## The main numbers

| Figure on the page         | Plain meaning                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| Total Investment           | Everything the organization spent on the project: direct fees plus the estimated cost of staff time |
| Total Return               | Estimated value the organization receives                                                           |
| Net Return                 | Total Return minus Total Investment                                                                 |
| ROI (return on investment) | Net Return as a share of investment, shown as a percentage: `(return − investment) / investment`    |
| BCR (benefit-cost ratio)   | Return per dollar invested, shown as a multiple such as 5×: `return / investment`                   |

**Note:** ROI and BCR carry the same information: `BCR = ROI + 1`. ROI and BCR are blank when there is no investment to divide by.

Two model concepts sit behind these figures but are not shown on the page:

- **Markup** — the value the organization perceives per dollar of direct cost. It is how the model recovers return from behavior. See [How the model works](../how-it-works/).
- **Break-even markup** — the markup at which return would exactly equal investment. It is `investment / (cost of the efficient mix)`, so it is at least 1.

Return is the markup times the cost of the _efficient_ version of the organization's portfolio. An organization whose actual mix of contributions costs more than the efficient mix therefore has a lower BCR than its markup. The model calls the ratio the allocative efficiency: `BCR = markup × allocative efficiency`. See [Allocative efficiency](../inference/#allocative-efficiency).

## Reading them

- **ROI of 50%** means each dollar invested is estimated to return a dollar and a half. Net gain is 50 cents per dollar.
- **ROI of 0%** (BCR of 1) is break-even. For some pairs it is a lower bound rather than an estimate. When the calibrated markup would put a pair's value below its investment, the model raises the markup to break-even, because an organization that keeps contributing must value participation at least at its cost. An ROI of 0% therefore means "at least break-even". See [Participation floor](../inference/#participation-floor).
- **ROI is not negative.** Because of that floor, estimated value is never below investment for a pair.
- **A high break-even markup** means the investment is large relative to the cost of the efficient mix, so the pair needs a high perceived value per dollar to justify it.

## Things to keep in mind

- **Investment is estimated.** Staff time is derived from activity counts and [estimated hours per activity](../activity-time-costs/), multiplied by standard salaries and overhead. It is a consistent yardstick, not a payroll record.
- **Only observed activity counts.** Private work, work not tied to a recorded project, and activity LFX cannot attribute to an organization are not captured.
- **Value is inferred, not observed.** It reflects behavior plus a calibrated distribution, not a measured benefit.
- **ROI is not a recommendation.** Projects are complements as well as alternatives, so pair-level numbers should not be used to pick a single "best" project.
- **Two markup methods.** Results are available for two ways of ranking pairs (logistic and direct). See [Stage 1: markups](../stage-1-markups/). They differ in how behavior is converted to a ranking and usually agree on the broad picture.
- **Yearly figures are an allocation.** Annual value and profit are the total split by each year's share of spend. They do not independently estimate value per year. See [Annualization](../inference/#annualization).

## Related reading

- [How the model works](../how-it-works/)
- [ROI FAQ](../faq/)
- [Inference (technical)](../inference/)
