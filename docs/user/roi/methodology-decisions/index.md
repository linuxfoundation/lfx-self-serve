---
title: Methodology decisions
description: Why the ROI model makes the choices it does — counting each resource once, summing value year by year, the stage 2 weighting choices, the participation floor, scale control, and why there is no minimum-data threshold.
audience: [all]
product_area: Dashboards
display_order: 13
tags: [roi, methodology, rationale, participation floor, scale control]
last_updated: 2026-11-05
intercom_collection: Dashboards
---

The other technical pages say **what** the model does. This page says **why**: the choices that most affect the numbers, what went wrong before each was made, and what each means for how you read a result. It does not repeat the mechanics, so each section links to the page that describes them. It is meant for readers who want to judge the model, not only use it.

For which company-project pairs are modelled, see [Which pairs are modelled](../data-overview/#which-pairs-are-modelled).

## Count each resource once

The ROI page answers one question: what resources did we put into open source, and what did we get back, by project, contribution type, and year? Summing any breakdown of that must never count the same resource twice. The three attribution rules that guarantee it are in [Counting each resource once](../data-overview/#counting-each-resource-once). Without them:

- **Forks and mirrors.** Before duplicates were collapsed, kernel history imported through a fork made the fork look larger than the kernel, and imported history drove the top of the ROI ranking.
- **Membership fees.** Using a later renewal date instead of the real term stacked several years of fees into one year.
- **Timestamps.** Collapsing activity by timestamp merged different contributions that share a time, such as the commits in one merge, which undercounted activity.

## Sum value year by year

Value is computed for each year from that year's quantities and prices, and then summed ([CES branch](../inference/#ces-branch)). Total return is the markup times the sum of those yearly values, compared with investment summed over the same years.

An earlier version built value from per-year _averages_, which is one year of value, and compared it with spending summed over all years. As a result the benefit-cost ratio shrank roughly in proportion to the number of years a pair was active, and about half of all rows showed a negative ROI.

The yearly view on the ROI page then **apportions** the total across years by each year's share of spending ([Annualization](../inference/#annualization)). This is deliberate. Measuring value separately for each year gave a negative profit in a small share of project-years. That is noise from a single year's mix, not information a company can act on. Apportioning keeps the years adding up to the totals and keeps any year from turning negative when the total is not. The final year is usually partial and is labelled as such.

## Stage 2 weighting choices

Two choices keep the stage 2 estimates comparable and stable. The mechanics are in [Stage 2: CES allocation](../stage-2-ces/).

- **Keep the share parameters on one scale.** Fixed-unit types (memberships and sponsorships, whose quantity is always 1) once used a raw spending share, which is correct only in a special case and sat on a different scale from the other weights. Weights were also clipped before they were normalized, which left many pairs with tied weights. Together these produced most of the negative ROI. Now every type gets its weight from the same identity, normalized before it is clipped (see Recovering α on that page).
- **Use a pooled prior when substitution cannot be identified.** Some pairs cannot identify how easily one contribution type replaces another from their own history. The model fixes it for them at the pooled estimate from well-identified pairs instead of an arbitrary constant. See [Two-pass pooled elasticity prior](../stage-2-ces/#two-pass-pooled-elasticity-prior), which also gives the reason.

## The participation floor

The reasoning and the formula are in [Participation floor](../inference/#participation-floor). Two things are worth knowing here. The share of floored pairs is small, and it falls as years of activity rise. And for a floored pair, an ROI of 0% is a **lower bound** ("contributes at least at break-even"), not a point estimate. See [Reading them](../interpreting-results/#reading-them).

## Control for scale in the markup

Stage 1 ranks pairs on participation **net of investment scale and observation window** ([Investment scale](../stage-1-markups/#investment-scale)). This section records the evidence for that choice.

Before the control, markups correlated strongly with log scale: the median markup rose from the bottom to the top spending decile, and return summed over all pairs was far larger than spending. After it, the correlation is small and the spending gradient nearly flat.

### Why the logistic method is the default

- Its markups are least related to scale and window length.
- It produces few ties, while the direct method's raw rate takes few distinct values and bunches many pairs onto the same markup.
- It pools information across a company's projects and a project's companies, which steadies short or sparse histories.
- It gives a nearly flat spending gradient, so spend-weighted return sits close to the survey-anchored level.

The direct method's rate saturates at 1 for always-active pairs, which a linear control cannot fully remove, so it keeps a heavier top tail. Use it as a robustness check. The two methods rank pairs alike for most of the range, and a minority of pairs differ by more than a factor of two.

### Known residual

The logistic method's most extreme markups go to very small pairs, such as those with only a few hundred dollars of total spending. They are immaterial in dollars but stand out in pair-level rankings, which is part of why the ROI page only shows companies that pass the [display gate](../interpreting-results/#which-companies-are-shown).

## Why there is no minimum-data threshold on the model

Raising the minimum history for a pair (for example to two years) was considered and rejected:

- **Large cost.** It would drop about a sixth of all pairs, to remove a few negative rows.
- **Wrong target.** Those negatives came from the share-clipping issue above, not from thin data. Negatives from edge elasticities had a long history, so a threshold would not reach them.
- **It shifts calibration.** Markups are calibrated by rank across all valid pairs. Removing a slice of pairs changes the population, and with it every other pair's markup.

Thin data is handled where it should be, at display time: see the [display gate](../interpreting-results/#which-companies-are-shown).

## Related reading

- [Interpreting results](../interpreting-results/)
- [Inference](../inference/)
- [Stage 1: markups](../stage-1-markups/)
- [Stage 2: CES allocation](../stage-2-ces/)
- [Data overview](../data-overview/)
- [ROI documentation](../)
