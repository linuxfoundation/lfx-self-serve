---
title: The ROI model (technical)
description: A self-contained description of the LFX contribution ROI model — notation, economic setup, the two estimation stages, the inference step, and the assumptions the estimates rest on.
audience: [all]
product_area: Dashboards
tags: [roi, model, markup, ces, revealed preference, assumptions, technical]
last_updated: 2026-10-30
intercom_collection: Dashboards
---

This section describes the ROI model as a mathematical and economic model, in enough detail to follow and reproduce the estimates from the text alone. It is not written as a publication, but each step is stated precisely: what is observed, what is assumed, what is estimated, and how. For an introduction without formulas, start with [How the model works](../how-it-works/).

The model takes contribution behavior and recovers the value an organization must perceive for that behavior to be rational.

```text
Data  ──►  Stage 1: participation  ──►  markup μ(i,j)          ┐
      ──►  Stage 2: allocation     ──►  shares α(k), elasticity σ ├──►  Inference: value, ROI
                                                                 ┘
```

Equations are written in plain text. Subscripts are written in parentheses, `x(i,j,k,t)`, and `Σ` denotes a sum.

## Notation

| Symbol                 | Meaning                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `i`, `j`               | Organization, project                                                        |
| `t`                    | Time period: month in stage 1, calendar year in stage 2                      |
| `k`, `K`               | Contribution type, number of contribution types                              |
| `d(i,j,t)`             | 1 if organization `i` contributes to project `j` in period `t`, else 0       |
| `x(i,j,k,t)`           | Quantity of contribution type `k` (code in FTE, attendees, units, and so on) |
| `p(i,j,k,t)`           | Unit price of type `k`, in USD                                               |
| `μ(i,j)`               | Markup: perceived value per dollar of direct cost                            |
| `α(k)`, `σ`            | CES share parameters and the elasticity of substitution                      |
| `Y(i,j,t)`, `P(i,j,t)` | Composite contribution output and its price index                            |

The contribution types are code, community, meetings, event attendance, event sponsorship, project membership, Linux Foundation membership, and education courses. See [Data overview](../data-overview/).

## Setup

An organization makes two linked decisions about a project:

- **Extensive margin:** whether to contribute at all.
- **Intensive margin:** how to allocate investment across contribution types once it contributes.

Contribution value is latent: we observe spending and activity, not the benefit. The identifying idea is _revealed preference_. Repeated costly contribution implies perceived benefits that justify the cost.

The central object is the **markup**:

```text
μ = (perceived strategic value) / (direct contribution cost)
```

`μ > 1` means perceived value exceeds the direct cost of an efficiently allocated portfolio, and `μ = 1` means it equals it. Because an organization's actual mix of contributions can cost more than the efficient mix, the markup at which value exactly equals investment is the **break-even markup** `I / (P · Y)`, which is at least 1 (see [Inference](../inference/)). The framing is mechanism agnostic: the model does not specify why value arises, only how large it must be.

## Two-stage structure

1. **Stage 1 (participation)** identifies which organization-project pairs have higher latent value, and produces `μ(i,j)`. See [Stage 1: markups](../stage-1-markups/).
2. **Stage 2 (allocation)** identifies how contribution types combine into output, producing `α(k)` and `σ` for each pair. See [Stage 2: CES allocation](../stage-2-ces/).
3. **Inference** combines both with observed quantities and prices to compute value and ROI. See [Inference](../inference/).

### Stage 1: random-utility participation

For each pair, contributing is one option and not contributing is the other. The latent net utility of participating is

```text
u(i,j,t) = δ(i) + π(j) + β · d(i,j,t−1) + λ · z(i,j) + ε(i,j,t)
d(i,j,t) = 1  if u(i,j,t) > 0,  else 0
```

with an organization effect `δ(i)`, a project effect `π(j)`, a persistence coefficient `β` on last period's participation, a coefficient `λ` on the pair's investment scale `z(i,j)` (a control, so that team size is not mistaken for perceived value), and a logistic shock `ε`. A higher markup raises the utility of participating, so higher-markup pairs participate more consistently. This implies the participation probability

```text
Pr[ d(i,j,t) = 1 ]  =  1 / (1 + exp( −(δ(i) + π(j) + β · d(i,j,t−1) + λ · z(i,j)) ))
```

### Stage 2: CES allocation

Conditional on participating, the organization combines contribution types into a composite output with a constant-elasticity-of-substitution (CES) technology:

```text
Y(i,j,t) = A · [ Σ_k  α(k)^(1/σ) · x(i,j,k,t)^((σ−1)/σ) ] ^ (σ/(σ−1))
```

with these restrictions:

- `A = 1`. The scale is normalized, because it is not separately identified from the markup.
- `α(k)` is in (0, 1) and `Σ_k α(k) = 1`.
- `σ > 0` and `σ ≠ 1`. A larger `σ` means types are closer substitutes. As `σ` approaches 0 they become perfect complements.

The technology has constant returns to scale: doubling every `x` doubles `Y`. The corresponding **price index** is

```text
P(i,j,t) = [ Σ_k  α(k) · p(i,j,k,t)^(1−σ) ] ^ (1/(1−σ))
```

**Cost minimization.** For a target output `Y`, the cheapest way to produce it solves

```text
minimize over x:   Σ_k p(k) · x(k)        subject to   Y(x) ≥ Y
```

With multiplier `φ` on the constraint, the first-order condition for each type is `p(k) = φ · ∂Y/∂x(k)`. Differentiating the CES function gives `∂Y/∂x(k) = (Y/x(k))^(1/σ) · α(k)^(1/σ)`, so for any reference type 0,

```text
p(k) / p(0)  =  (α(k)/α(0))^(1/σ) · (x(0)/x(k))^(1/σ)

⇒   x(k) / x(0)  =  (α(k) / α(0)) · ( p(0) / p(k) )^σ                     (★)
```

Substituting (★) back into `Y` and into the cost `Σ p(k) x(k)` shows that the minimum cost is exactly `P · Y`, with `P` the price index above. So **`P · Y` is the cost-minimizing expenditure to produce `Y` at the observed prices.** Condition (★) is the basis of the stage 2 estimator.

**Value and net return.** The strategic value of the contribution is `μ(i,j) · P · Y`, and the net return is

```text
Π(i,j,t) = μ(i,j) · P(i,j,t) · Y(i,j,t)  −  Σ_k p(i,j,k,t) · x(i,j,k,t)
```

Because the technology has constant returns, the first-order conditions pin down the **mix** of contribution types (condition ★) but not the **scale** of spending. The model therefore takes the level of investment as observed and uses the mix condition to learn the technology. This is a deliberate simplification. It is why the model describes how an organization allocates, and not how much it should contribute.

## Inference in one paragraph

With `μ`, `α`, and `σ` estimated, the value of a pair's contribution portfolio is `μ · P · Y`, where `P · Y` is computed from observed quantities and prices. Investment is observed spending `I = Σ p · x`. ROI is `(V − I) / I`. Value is summed over years, `V = μ · Σ_t P_t · Y_t`, so it covers the same years as investment. If the calibrated markup would put a pair's value below its investment, the markup is raised to break-even (the [participation floor](../inference/#participation-floor)), so ROI is never negative. Because `P · Y ≤ I` (a portfolio can only cost as much as, or more than, its cost-minimizing version), `BCR = V / I = μ × (P·Y / I)`: the markup scaled down by how efficiently the observed mix matches the fitted one. See [Inference](../inference/).

## Key assumptions

The estimates rest on these assumptions. They are listed so a reader can judge where the model fits their case and where it does not.

1. **Revealed preference.** Sustained, costly contribution implies perceived value at least equal to its cost. Organizations are assumed to be rational, to have preferences that are stable over time, and to be reasonably well informed.
2. **Participation reveals ranking, not level.** Behavior orders pairs by perceived value. The overall level of markups is not estimated. It is set by calibration to the LF Research Open Source ROI Survey (a shifted gamma distribution whose mean and standard deviation are listed in [Model settings and defaults](../model-settings/#markup-estimation-stage-1)). A different target distribution would rescale all value estimates.
3. **Participation is binary and persistent.** A pair is active in a month if there is any code or community activity. Persistence is captured by a one-month lag and organization and project effects, net of the pair's investment scale and observation window. Other contribution types do not enter the participation signal.
4. **Participation shocks are logistic.** The idiosyncratic component of each month's decision follows a logistic distribution, independent across periods given the lag.
5. **CES technology with constant returns.** Contribution types combine into a composite output through a CES function with a single elasticity per pair and type shares that sum to one. `A` is normalized to 1.
6. **Prices are exogenous.** Prices are administratively set benchmarks (salary benchmarks, posted membership fees, event prices), so the estimator treats them as given rather than as responses to the organization's choices.
7. **Labor is valued at opportunity cost.** Staff time is converted from estimated hours per activity into FTEs and valued at flat, organization-independent salaries and overheads. Hours per activity are domain-knowledge estimates.
8. **The mix is cost-minimizing.** Observed allocations are treated as noisy realizations of the cost-minimizing mix. Deviations are residuals.
9. **Pairs are independent.** Each pair is evaluated on its own, so complementarities between projects are not modeled. The sum of pair-level values can understate the value of a portfolio.
10. **Value of contributing only.** The model values perceived value from contributing. It does not value the use of the software, which is generally larger.
11. **Observed activity only.** Work not recorded in LFX data, or not attributable to an organization, is outside the model.

## What the product implements

The equations above are the research methodology. In production, some compromises are made for technical feasibility. Some inference features are under development. In summary:

| Topic                                 | Research methodology                                  | Product                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Markup estimation                     | One logit-based ranking                               | Two methods, logistic and direct, both retained                                                                                  |
| Elasticity estimation                 | GMM from the first-order conditions, with instruments | Least squares on the per-year first-order conditions (a constant instrument), with a closed-form `σ` when all types are flexible |
| Mechanism and counterfactual analysis | Described                                             | Not implemented                                                                                                                  |

## Pages in this section

- [Stage 1: markups](../stage-1-markups/) — participation model and calibration to a markup distribution
- [Stage 2: CES allocation](../stage-2-ces/) — estimating elasticity and shares
- [Inference](../inference/) — value, ROI, and annualization
- [Model settings and defaults](../model-settings/)
