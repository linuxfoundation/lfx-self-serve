---
title: 'Stage 1: markups'
description: How the ROI model turns monthly participation histories into a markup for each organization-project pair — the participation model, the two scoring methods, and calibration to a target distribution.
audience: [all]
product_area: Dashboards
tags: [roi, markup, logit, participation, calibration, gamma, technical]
last_updated: 2026-10-16
intercom_collection: Dashboards
---

Stage 1 takes each organization-project pair's participation history and produces one markup `μ(i,j) ≥ 1` for each of two methods, **logistic** and **direct**. Both are shown on the ROI page under **Model assumptions**.

## Input

A monthly binary panel per organization-project pair, built as described in [Data overview](../data-overview/#contribution-frequency-stage-1-input):

- `d(i,j,t) = 1` if the pair had any code or community activity in month `t`, else 0.
- `d(i,j,t−1)` is the previous month's value. The first month's missing lag is set to 0.
- A pair enters only if it has at least one active month after the project's start.

A pair receives a markup only if it has at least **3 months** of data and at least one active month.

Only code and community activity define participation. Memberships, events, meetings, and courses do not enter the participation indicator.

## Participation model

The specification is

```text
d(i,j,t) = 1 if u(i,j,t) > 0,   u(i,j,t) = a(i) + g(j) + β · d(i,j,t−1) + ε(i,j,t)
```

with `ε` logistic, which makes the participation probability a binary logit in the organization effect, the project effect, and the lag. It is estimated by maximum likelihood on:

- a full set of organization indicators and project indicators, plus
- the lagged activity indicator, plus an intercept.

A very weak L2 penalty (inverse regularization strength `C = 1000`) is included for numerical stability, since a full set of indicators is collinear with the intercept. It has a negligible effect on fitted values.

## From utility to markup

The model needs a **ranking** of pairs by perceived value. Two methods produce one. Both are then mapped onto the same target distribution of markups.

### Logistic method

1. Compute the fitted linear predictor `û(i,j,t) = â(i) + ĝ(j) + β̂ · d(i,j,t−1)` for every **active** pair-month.
2. Average over active months to get one score per pair:

```text
û(i,j) = (1 / T(i,j)) · Σ_t  û(i,j,t) · d(i,j,t)
```

where `T(i,j)` is the number of active months. Inactive months are not scored.

### Direct method

Skip the model. Use the empirical activity rate as the score:

```text
p̂(i,j) = (active months) / (months in the panel)
```

### Quantile mapping (both methods)

Let `n` be the number of valid pairs and `r(i,j)` the rank of the pair's score among all pairs. Ties share the average rank. Then

```text
q(i,j) = ( r(i,j) − 0.5 ) / n          (a quantile strictly between 0 and 1)
μ(i,j) = F⁻¹( q(i,j) )
```

where `F` is a **shifted gamma** distribution on `[1, ∞)`: a gamma distribution with shape `a` and scale `θ`, shifted right by 1. It is matched to a target mean `m` and standard deviation `s`. The shift contributes 1 to the mean and nothing to the variance, so

```text
mean = 1 + a·θ = m        variance = a·θ² = s²
⇒   θ = s² / (m − 1),     a = (m − 1)² / s²
```

The method requires `m > 1` and `s > 0`. With the defaults `m = 3` and `s = 2`, `a = 1` and `θ = 2`, which is an exponential distribution shifted to start at 1.

## Properties

- **The ordering comes from behavior.** The mapping is monotone, so a pair with a higher score always has a weakly higher markup.
- **The level comes from calibration.** The target distribution is anchored to the LF Research [Open Source ROI Survey](https://www.linuxfoundation.org/research/contribution-roi). It is not estimated from the panel.
- **Both methods share a distribution.** Because both map onto the same `F`, they differ only in _which pairs_ receive the high values.
- **Markups are at least 1.** The support of `F` starts at 1, so the markup never says a contribution is worth less than its direct cost by construction. A pair's ROI can still be negative, because value is `μ · P · Y` and `P · Y` can be below observed investment. See [Inference](../inference/).
- **Markups are relative.** A pair's markup depends on its rank among all valid pairs. It changes when other pairs enter or leave the panel, even if its own behavior is unchanged.

## Related reading

- [The model](../model/)
- [Stage 2: CES allocation](../stage-2-ces/)
- [Model settings and defaults](../model-settings/)
