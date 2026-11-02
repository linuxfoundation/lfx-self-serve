---
title: 'Stage 1: markups'
description: How the ROI model turns monthly participation histories into a markup for each organization-project pair — the participation model, the two scoring methods, and calibration to a target distribution.
audience: [all]
product_area: Dashboards
tags: [roi, markup, logit, participation, calibration, gamma, technical]
last_updated: 2026-10-30
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

### Investment scale

Participation is recorded as "any activity this month". A pair with dozens of engineers is active in almost every month, whatever value it places on the project, so raw persistence partly measures team size. The markup is meant to be a scale-free ratio (value divided by efficient cost). Ranking pairs by raw persistence would count size twice, once through spending and again through the markup.

Both methods therefore rank pairs on participation **net of investment scale**. The scale measure is

```text
z(i,j) = standardized( log( total spending of the pair / number of years with spending ) )
```

that is, the log of the pair's mean spending per active year, standardized across pairs. Pairs without priced spending (rare, and they never reach inference) are given the median.

## Participation model (logistic method)

The specification is

```text
d(i,j,t) = 1 if u(i,j,t) > 0
u(i,j,t) = δ(i) + π(j) + β · d(i,j,t−1) + λ · z(i,j) + ε(i,j,t)
```

with an organization effect `δ(i)`, a project effect `π(j)`, a persistence coefficient `β`, a scale coefficient `λ`, and a logistic shock `ε`. This makes the participation probability a binary logit. It is estimated by maximum likelihood on:

- a full set of organization indicators and project indicators,
- the lagged activity indicator and the scale measure, plus an intercept.

A very weak L2 penalty (inverse regularization strength `C = 1000`) is included for numerical stability, since a full set of indicators is collinear with the intercept. It has a negligible effect on fitted values.

## From utility to markup

The model needs a **ranking** of pairs by perceived value. Two methods produce one. Both are then mapped onto the same target distribution of markups.

### Logistic method

1. Compute the fitted linear predictor `û(i,j,t)` for every **active** pair-month, and remove the fitted scale contribution: `û(i,j,t) − λ̂ · z(i,j)`.
2. Average over active months to get one score per pair, where `n_act(i,j)` is the number of active months. Inactive months are not scored:

   ```text
   v(i,j) = (1 / n_act(i,j)) · Σ_t  ( û(i,j,t) − λ̂ · z(i,j) ) · d(i,j,t)
   ```

3. Residualize the score on scale and window length (see below).

### Direct method

Skip the model. Convert the pair's empirical activity rate into smoothed log-odds, where `n_act` is the number of active months and `T` the number of months in the panel:

```text
v(i,j) = log( (n_act + 0.5) / (T − n_act + 0.5) )
```

and then residualize the score on scale and window length. The raw rate `n_act / T` takes few distinct values, so many pairs would otherwise share an identical markup. The residual breaks those ties.

### Residualizing on scale and window length

For each method, the pair scores are regressed by ordinary least squares, with an intercept, on two controls, and the **residual** is ranked:

```text
v(i,j) = c0 + c1 · z(i,j) + c2 · log( months observed(i,j) ) + residual(i,j)
```

- **Scale `z(i,j)`.** In the logistic method the scale term in the model removes most of the effect of team size. Big projects also attract more of an organization's spending and near-constant activity, so scale can still leak back in through the project effects. The residualization removes what is left. In the direct method it is the only scale control.
- **Window length.** The panel starts at the project's start date, so pairs on young projects are observed over a short, launch-heavy window with high activity rates. Persistence over 6 months and over 10 years is not comparable evidence, and a project's age should not change ROI per dollar.

What is kept is persistence relative to scale and window length and, in the logistic method, organization and project effects unrelated to scale.

### Quantile mapping (both methods)

Let `N` be the number of valid pairs and `r(i,j)` the rank of the pair's score among all pairs. Ties share the average rank. Then

```text
q(i,j) = ( r(i,j) − 0.5 ) / N          (a quantile strictly between 0 and 1)
μ(i,j) = F⁻¹( q(i,j) )
```

where `F` is a **shifted gamma** distribution on `[1, ∞)`: a gamma distribution with shape `a` and scale `θ`, shifted right by 1. It is matched to a target mean `m` and standard deviation `s`. The shift contributes 1 to the mean and nothing to the variance, so

```text
mean = 1 + a·θ = m        variance = a·θ² = s²
⇒   θ = s² / (m − 1),     a = (m − 1)² / s²
```

The method requires `m > 1` and `s > 0`. The target mean and standard deviation are listed in [Model settings and defaults](../model-settings/#markup-estimation-stage-1), together with the resulting shape and scale.

## Properties

- **The ordering comes from behavior.** The mapping is monotone, so a pair with a higher score always has a weakly higher markup.
- **The level comes from calibration.** The target distribution is anchored to the LF Research [Open Source ROI Survey](https://www.linuxfoundation.org/research/contribution-roi). It is not estimated from the panel.
- **Both methods share a distribution.** Because both map onto the same `F`, they differ only in _which pairs_ receive the high values.
- **Raw markups are at least 1.** The support of `F` starts at 1. Inference can raise a pair's markup further, to its break-even level, so that the pair's value is never below its investment. See [Participation floor](../inference/#participation-floor).
- **The logistic method is the default.** Its markups are the least related to team size and window length, it produces few ties, and it pools information across an organization's projects and a project's organizations, which steadies short or sparse histories. The direct method's rate saturates at 1 for always-active pairs, which a linear control cannot fully remove, so it keeps a heavier top tail. Treat it as a robustness check.
- **Markups are relative.** A pair's markup depends on its rank among all valid pairs. It changes when other pairs enter or leave the panel, even if its own behavior is unchanged.

## Related reading

- [The model](../model/)
- [Stage 2: CES allocation](../stage-2-ces/)
- [Model settings and defaults](../model-settings/)
