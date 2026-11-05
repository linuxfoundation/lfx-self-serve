---
title: Value driver decomposition
description: The method behind the Value drivers chart — the driver taxonomy, proxies and controls, the additive Shapley decomposition of the log markup, how percentages are computed, how much is explained, and the limits.
audience: [all]
product_area: Dashboards
display_order: 12
tags: [roi, value drivers, decomposition, shapley, markup, technical, taxonomy]
last_updated: 2026-11-05
intercom_collection: Dashboards
---

This page describes the value driver decomposition as a model: what is decomposed, what the inputs are, how the pieces are estimated, and what the numbers do and do not mean. For a plain-language reading of the chart, start with [Value drivers](../value-drivers/). For the individual measurements, see [The measurements behind the chart](../value-drivers/#the-measurements-behind-the-chart).

Equations are written in plain text. `ln` is the natural logarithm and `Σ` a sum.

## Purpose

The ROI model estimates a **markup** `μ(i,j)` for each company-project pair: how much more value the company perceives than the efficient cost of its contribution ([Stage 1](../stage-1-markups/)). The markup says _how much_ value. The decomposition asks _where it comes from_. It compares each pair with a **typical pair** and splits the difference across the **value drivers** of the LFX taxonomy (for example developer productivity, talent acquisition, shared R&D), grouped into five categories. Summed over a company's projects, it answers the question a company asks of its portfolio: which factors do we get our value from?

For a pair, a result reads like this:

> Compared with a typical pair, this pair has 12% more markup because of shared R&D, 5% more because of developer productivity, 3% less because of ecosystem goodwill, and its controls (funding share, project type, company breadth and the like) take away 6%.

For a company, which is the view on the ROI page:

> Across its projects, this company earns x% more (or less) markup than a portfolio of typical pairs would, because of this value driver category.

Three things hold throughout:

- **It describes association, not cause.** A proxy that goes with the markup is not shown to cause it.
- **It describes the explained part.** The model explains a part of the variance of `ln(μ)`, well short of all of it. What the proxies cannot explain is not allocated to any driver.
- **It is relative to the typical pair.** The typical pair, also called the average pair, has the geometric mean markup: the markup whose log is the average of the model's predictions of `ln(μ)`. A driver separates a pair from the typical one. It does not measure the total value the driver provides.

## The value driver taxonomy

The taxonomy has 17 value drivers in five categories. Eight drivers have a measurable proxy and appear in the output. Nine do not and have no result.

| Category            | Driver                                  | What it is                                                                | In the output |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------- | ------------- |
| Direct cost savings | Shared R&D                              | Developing non-core infrastructure with peers to split costs              | Yes           |
|                     | Maintenance offloading                  | A global community carries bug fixes, patches and updates                 | Control only  |
|                     | License displacement                    | Replacing a paid proprietary product with the open source project         | No proxy      |
| Revenue boosters    | Developer productivity                  | Improving internal tooling to speed time to market                        | Yes           |
|                     | Standardization leadership              | Making the company's architecture the industry standard                   | Yes           |
|                     | Complement for a priced good or service | Contributing to open source that complements what the company sells       | No proxy      |
|                     | Hardware or platform pull-through       | Open source that enables the company's hardware or platform               | No proxy      |
| Risk mitigation     | Technical debt reduction                | Upstreaming patches instead of keeping a private fork                     | Yes           |
|                     | Project longevity                       | Keeping the software maintained if its creator leaves                     | Yes           |
|                     | Supply chain security                   | Keeping critical dependencies secure and patched                          | No proxy      |
|                     | Vendor independence                     | A credible open source exit from a dominant proprietary vendor            | No proxy      |
|                     | Regulatory compliance                   | Contributing to meet regulation (for example the EU Cyber Resilience Act) | No proxy      |
| Strategic           | Talent acquisition and development      | Open source as a talent attractor and upskilling engine                   | Yes           |
|                     | Competitive intelligence                | Early visibility into where a technology is heading                       | Yes           |
|                     | Brand authority                         | Signalling technical expertise to customers and partners                  | Control only  |
|                     | Market shaping                          | Developing an open source substitute to capture market share              | No proxy      |
| Prosocial           | Ecosystem goodwill                      | Social capital that eases future collaboration                            | Yes           |

Some of the most commonly cited reasons to contribute are in the "No proxy" rows. That is a finding about the data available, not about those motives: they may matter, but nothing here can measure them. Category totals cover their observed drivers only.

## Proxies and controls

A driver is not observable, so each is represented by **proxies** built from LFX data. There are 19 proxies per company-project pair, and each has one of two roles:

- **Value proxy** (12). More of it means more benefit, it describes the pair and not only the company or the project, and the data does not contradict that. Value proxies build the index of their driver and earn the driver's contribution.
- **Control** (7). Kept in the model to absorb confounding, but not attributed to a driver. They are cost-like or crowding proxies that lower the markup once the others are in the model (project funding share, foundation flag, forks, stars, event attendance), a proxy with no coherent direction (maintenance offload), and a company-level proxy (breadth, the number of projects the company contributes to). Their combined effect is reported as a single **context** component.

The markup is scale-free: it is participation net of investment size and observation window. Every proxy is therefore a rate, a share, an indicator, a breadth, or a count that is not a spend level. Raw activity volume is not used, because it is the markup's own input and would "explain" the markup by construction. Which proxies belong to which driver, and what each one measures, is listed in [The measurements behind the chart](../value-drivers/#value-proxies-by-driver).

### How a proxy gets its role

A proxy is a value proxy when all of these hold:

1. Theory says the driver's benefit rises with it.
2. It describes the pair and not only the company or the project: less than 90% of its variation is between companies, or between projects.
3. The data does not contradict the theory. Forced to act as a non-decreasing value proxy of its driver, it does not lower out-of-fold fit (see [How much is explained](#how-much-is-explained)) and keeps a positive effect.

A proxy that fails rule 2 or 3 stays in the model as a control. Its confounding is absorbed and shows up in the context component, but it earns no driver contribution. Rule 2 screens company-level labels, not binary project flags. The project maturity flag has two values and cannot identify a project, so it passes and is a value proxy. Read its contribution as a project-level premium.

## How the decomposition works

### The idea

The markup is value divided by cost, so a driver that adds to value scales the markup instead of adding to it. On the log scale the drivers are additive:

```text
ln(μ) = base + Σ_d φ(d) + φ(context) + u
```

- `base` is the log of the typical markup `μ_ref`.
- `φ(d)` is driver `d`'s **Shapley value**: the signed effect of the pair's activity in that driver relative to the average pair (positive above it, negative below it).
- `φ(context)` is the same for the controls.
- `u` is what nothing measured explains. It is not allocated.

### The model

It is fitted separately for the logistic and the direct markups.

1. **One index per driver.** Each value proxy is turned into its percentile rank over all pairs, where missing counts as none. The proxies of a driver are combined into one index in [0, 1] with non-negative weights that sum to 1. The weights come from a non-negative least squares fit of `ln(μ)` that includes the controls, so confounding is absorbed before the value proxies get weight. A driver has one index and one shape function, so adding or duplicating a proxy refines the index but cannot add to the driver's effect.
2. **A monotone, driver-additive model.** Gradient-boosted trees (XGBoost) fit `ln(μ)` with depth-2 trees, non-decreasing in every driver index. Each driver index is alone in its interaction group and the controls share one group. So drivers are additive, and controls can interact only with each other. That makes each driver's Shapley value one exact quantity, with no coalition game among drivers.
3. **Out-of-fold.** In 5-fold cross-validation, each pair is scored by a model, and index weights, that did not see it. The folds split pairs, not projects (see [Limitations](#limitations)).
4. **Shapley values.** TreeSHAP splits each held-out prediction exactly into `base + Σ φ(d) + φ(context)`. Because the model is additive in drivers, `φ(d)` is the driver's centred main effect.

### Units

The log effects convert to markup units with the **log-mean rule**, which splits the change in level exactly across the log components:

```text
L          = (μ̂ − μ_ref) / (ln μ̂ − ln μ_ref)          μ̂ = out-of-fold predicted markup
value(c)   = L · φ(c)                                  for every component c
deviation(c) = 100 · value(c) / μ_ref                  percent deviation from the typical markup
```

The components then add up to `μ̂ − μ_ref`, and the percentages to `100 · (μ̂ / μ_ref − 1)`. When `μ̂ = μ_ref` the ratio is 0/0, so `L` is taken as its limit, `μ_ref`. The component values are then `μ_ref · φ(c)`: they can be nonzero, but they cancel and sum to 0.

The percent deviation from the typical markup is the unit of choice because it is **signed**, **additive** across drivers and categories within a pair or a portfolio, and **stable** for pairs near the average. Percentages of different pairs are not added to each other. Across pairs, the markup-unit values and the typical markups are each summed first, and the percentage is their ratio (see [Company level](#company-level)). A share of each pair's explained deviation would blow up for pairs near the average, where the total is near zero.

## Output and how to read it

### Pair level

For each company-project pair and markup method, there is one result for each of the 8 observed drivers and one for the context component, so 9 per pair and method:

| Quantity                                            | Meaning                                                                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Percent deviation from the typical markup           | The signed percent deviation from the typical pair due to this component. Negative means below typical. It is not a share of the markup. Over a pair's rows it sums to `100 · (μ̂ / μ_ref − 1)` |
| Value in markup units                               | The contribution in markup units. It sums to `μ̂ − μ_ref`                                                                                                                                       |
| Log contribution                                    | The Shapley effect on `ln(μ)`. It sums to `ln(μ̂) − ln(μ_ref)`                                                                                                                                  |
| Actual markup, predicted log markup, typical markup | The inputs repeated on each row of the pair. `ln(μ) − ln(μ̂)` is the unexplained part                                                                                                           |

### Company level

The ROI page reads a company-level roll-up: one row per company, markup method and category (the 5 categories plus context).

| Quantity                                  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Percent deviation from the typical markup | `100 · Σ (the company's pair values in the category) / Σ (the same pairs' typical markups)`: how much more or less markup the portfolio earns from the category than the same number of typical pairs would. Signed, and not a breakdown of the markup. The chart draws this as bars above and below the typical baseline. The five categories plus context add up to the portfolio's total explained deviation from typical. The chart shows only the five categories |
| Share of explained effect                 | The size of the category's effect as a percent of the five categories' combined size: `100 · abs(value) / Σ abs(value)`. Always 0 to 100 and sums to 100. It says which categories move the portfolio most, not in which direction. It is for ranking, and the chart does not show it                                                                                                                                                                                  |
| Number of projects                        | Projects in the portfolio. A few projects make category values noisy                                                                                                                                                                                                                                                                                                                                                                                                   |

**Two quantities, two jobs.** The percent deviation is the **signed deviation from the typical pair** (the baseline is 0). It answers "how much more or less markup than typical, and because of what", and it is the one to chart. It is not a percentage breakdown of the markup, which would make no sense with negative contributions. The share of explained effect is the **unsigned breakdown of the explained variation** across the five categories. It answers "which categories matter most" and is for ranking only.

### Reading tips

- Contributions are centred on the average pair, so their mean over all pairs is near 0. A driver matters when it moves pairs: use the average absolute value for importance overall, and the signed value for a pair, a project or a company.
- A driver at 0 is not "no value from that driver". It is "typical in that driver". A benefit every pair gets equally has a contribution of 0, however much value it carries.
- Category values cover observed drivers only, and a company with few projects has noisy values. The ROI page shows the breakdown only for companies with at least 5 projects, the range where the two markup methods agreed on category values.

## What the results mean

### How much is explained

The value proxies and controls explain a part of the variance of `ln(μ)`. It can be measured out-of-fold in four ways, from the most to the least demanding:

| Fit of `ln(μ)` (out-of-fold R²)                   | What it says                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Whole projects held out                           | How the model carries over to a project it has not seen                                                    |
| Whole companies held out                          | How the model carries over to a company it has not seen                                                    |
| Random folds, the model's own (folds split pairs) | The headline fit, but a within-project one: other pairs of the same project are in the training fold       |
| Across company means                              | The fit that matters for the company view, because pair-level noise averages out over a company's projects |

The held-out fits are lower than the random-fold fit, and the fit across company means is higher than all of them. The explained part is not larger largely for structural reasons. The markup is mostly a company effect and a project effect (identity alone explains far more than the proxies do), the two estimators disagree with each other, and the strongest natural proxies for value, size and spend, are controlled out of the markup by construction.

### Reading the drivers

- **The drivers with the most signal reflect the proxies available.** A large driver is not a finding that other motives are absent.
- **Pairs differ in which drivers matter.** Several drivers are about equally large for a typical pair, and for some pairs one driver holds most of the absolute driver contribution. A company's total hides these project differences.
- **Project longevity is a project-level contribution.** It rests on one project flag, so nearly all of its variation is between projects. Read it as "mature projects carry a longevity premium", not as a company's motive.
- **Some drivers show little signal.** A driver that moves few pairs by 1% or more has proxies with no detectable benefit that rises with the proxy once the controls are accounted for. Read that as "not detectable here", not as a ranking of those motives.
- **The two methods mostly agree on companies.** The exception is where a driver rests on proxies the methods weigh differently. Direct cost savings, which here is the single driver shared R&D, agrees least, because its two proxies are weighted differently by the two methods. Read shared R&D as method-dependent and prefer other categories for comparisons.
- **Extremes are weakly explained.** The model shrinks toward the middle, so contributions understate the forces behind the extremes.
- **Controls matter.** The context component is a sizeable part of a pair's movement, comparable to the drivers together. It shows where costs and identity raise or lower a pair's markup.

## Limitations

- The decomposition describes association, not cause, and attributes to 8 of the 17 drivers. Several of the eight show little signal.
- It decomposes the explained part only. Contributions say how the measured drivers move a pair relative to a typical one, not how much of its markup the drivers account for. Aggregates over many pairs are more reliable than a single pair.
- **The headline R² is within-project.** Folds split pairs, so other pairs of a project are in the training fold and project-level proxies can identify the project. The held-out fits above are the conservative reading.
- Contributions are relative to the average pair. Drivers are additive on the log scale, so synergies between drivers are not modelled. Value proxies are percentile ranks, so a driver's index says where a pair stands, not an absolute amount of activity.
- The decomposition is conditional on the markup's own ranking: contributions change when other pairs enter or leave.
- Company-level labels (breadth) are controls, so company roll-ups of drivers describe what the pair does, not who the company is.
- Several proxies come from the same sources as the markup's own participation record (events, meetings, certificates, activity), so they partly echo how the target is built. Weak mappings, such as collaboration share standing for shared R&D and platform count standing for ecosystem goodwill, are marked in [The measurements behind the chart](../value-drivers/#the-measurements-behind-the-chart).
- A proxy with no signal assigned to a driver blurs that driver's index and shrinks its effect. It cannot raise it.

## Integrity checks

The decomposition is only an explanation if it adds up, covers every markup, and recovers a known truth, so it is checked at several levels each time the model is rebuilt:

- **It adds up.** The components sum to the prediction minus the typical value, on both the log and the markup scale, and the company view is an exact roll-up of the pair model.
- **It covers everything.** Every company-project pair with a markup has a result for every observed driver and one context component. The drivers and categories match the taxonomy, and every proxy is present and not constant, all missing, or nearly all zero.
- **The percentage shares behave.** The share of explained effect stays between 0 and 100 and sums to 100.
- **It behaves like a centred, monotone effect (warnings).** Each driver's effect has a mean near zero and takes both signs, rises with at least one of its value proxies, and still moves a share of pairs by 1% or more of the typical markup.
- **Fit and agreement stay in bounds (warnings).** The fit and the size of the driver effects stay within bounds, and the two markup methods rank companies alike within each category.
- **The model guards itself.** Before fitting it compares the proxies it was given with the proxies it expects and stops on any disagreement. It also stops when a method has too few pairs to fit.

## Related reading

- [Value drivers](../value-drivers/) — how to read the chart
- [The measurements behind the chart](../value-drivers/#the-measurements-behind-the-chart) — what each proxy measures
- [Stage 1: markups](../stage-1-markups/) — where the markup comes from
- [ROI documentation](../)
