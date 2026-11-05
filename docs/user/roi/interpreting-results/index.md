---
title: Interpreting ROI results
description: What Total Investment, Total Return, Net Return, ROI, and BCR mean on the ROI Metrics page, how the underlying markup relates to them, and where the estimates have limits.
audience: [all]
product_area: Dashboards
display_order: 2
tags: [roi, bcr, markup, break-even, interpretation, investment]
last_updated: 2026-11-05
intercom_collection: Dashboards
---

The model produces one result for each company-project pair, for each markup method (see [below](#things-to-keep-in-mind)), plus a yearly breakdown of the same figures.

## The main numbers

| Figure on the page         | Plain meaning                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Total Investment           | Everything the company spent on the project: direct fees plus the estimated cost of staff time   |
| Total Return               | Estimated value the company receives                                                             |
| Net Return                 | Total Return minus Total Investment                                                              |
| ROI (return on investment) | Net Return as a share of investment, shown as a percentage: `(return − investment) / investment` |
| BCR (benefit-cost ratio)   | Return per dollar invested, shown as a multiple such as 5×: `return / investment`                |

**Note:** ROI and BCR carry the same information: `BCR = ROI + 1`. ROI and BCR are blank when there is no investment to divide by.

Two model concepts sit behind these figures but are not shown on the page:

- **Markup** — the value the company perceives per dollar of direct cost. It is how the model recovers return from behavior. See [How the model works](../how-it-works/).
- **Break-even markup** — the markup at which return would exactly equal investment. It is `investment / (cost of the efficient mix)`, so it is at least 1.

Return is the markup times the cost of the _efficient_ version of the company's portfolio. A company whose actual mix of contributions costs more than the efficient mix therefore has a lower BCR than its markup. The model calls the ratio the allocative efficiency: `BCR = markup × allocative efficiency`. See [Allocative efficiency](../inference/#allocative-efficiency).

## Reading them

- **ROI of 50%** means each dollar invested is estimated to return a dollar and a half. Net gain is 50 cents per dollar.
- **ROI of 0%** (BCR of 1) is break-even. For some pairs it is a lower bound rather than an estimate. When the calibrated markup would put a pair's value below its investment, the model raises it to break-even, so an ROI of 0% means "at least break-even". See [Participation floor](../inference/#participation-floor) for the reasoning.
- **ROI is not negative.** Because of that floor, estimated value is never below investment for a pair.
- **A high break-even markup** means the investment is large relative to the cost of the efficient mix, so the pair needs a high perceived value per dollar to justify it.
- **The Value drivers tab** explains where return comes from, not how large it is. See [Value drivers](../value-drivers/).

## Things to keep in mind

- **Investment is estimated.** Staff time is derived from activity counts and [estimated hours per activity](../contribution-labor/#hours-per-activity), multiplied by standard salaries and overhead. It is a consistent yardstick, not a payroll record.
- **Only observed activity counts.** Private work, work not tied to a recorded project, and activity LFX cannot attribute to a company are not captured.
- **Value is inferred, not observed.** It reflects behavior plus a calibrated distribution, not a measured benefit.
- **ROI is not a recommendation.** Projects are complements as well as alternatives, so pair-level numbers should not be used to pick a single "best" project.
- **Two markup methods.** Results are available for two ways of ranking pairs (logistic and direct). See [Stage 1: markups](../stage-1-markups/). They differ in how behavior is converted to a ranking and usually agree on the broad picture.
- **Yearly figures are an allocation.** Annual value and profit are the total split by each year's share of spend. They do not independently estimate value per year. See [Annualization](../inference/#annualization).

## Which companies are shown

A markup is the rank of a pair's participation persistence mapped onto a fixed distribution, and ROI also depends on how efficiently the contribution mix is spent. For a company with little measured spending or only a few active months, the markup, and so the ROI, is noisy: it can land at either extreme and mostly reflects how little data there is. So the model keeps every company but flags each one as displayable or not, and the ROI Metrics page shows only companies that are displayable.

A company is displayable when **all** of these hold:

- Its total spending, summed over its projects, reaches a minimum.
- Its active months, summed over its projects, reach a minimum.
- At least one of its projects has a minimum number of active months.

The minimums are listed in [Model settings and defaults](../model-settings/#display-gate). The gate is applied only when results are displayed. Every company-project pair is still used to estimate the markups, because a pair's markup is its rank among all pairs and removing pairs first would change everyone else's.

Why these rules:

- **Spending.** The two markup methods agree more as spending rises, so a small total gives a less reliable ROI.
- **Active months.** Pairs need at least three active months to be estimated at all. A pair that only just meets that rule has little history and ranks low by construction, so a company built from such pairs reflects a short history rather than low value.
- **Not the ROI value.** A floor on ROI would only hide the bottom of the ranking and flatter the tool. The gate asks whether the evidence is enough, not whether the result is good.
- **Not the project count.** A single-project company can still have a sound ROI.

The thresholds are product decisions, not statistical boundaries: the data shows no sharp noise cliff. For why the model itself has no minimum-data threshold, see [Methodology decisions](../methodology-decisions/#why-there-is-no-minimum-data-threshold-on-the-model).

## Related reading

- [How the model works](../how-it-works/)
- [ROI FAQ](../faq/)
- [Value drivers](../value-drivers/)
- [Inference (technical)](../inference/)
- [Methodology decisions](../methodology-decisions/)
- [ROI documentation](../)
