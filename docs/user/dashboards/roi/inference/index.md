---
title: Inference
description: How the ROI model combines markups, CES parameters, and observed spending into contribution value, ROI, BCR, and annual figures — with the research constructs that are not in the product.
audience: [all]
product_area: Dashboards
tags: [roi, inference, bcr, break-even, annualization, technical]
last_updated: 2026-10-16
intercom_collection: Dashboards
---

The inference layer combines the stage 1 markups, the stage 2 CES parameters, and observed quantities and prices into ROI metrics. Results are produced for each organization-project pair and each markup method, with a yearly breakdown.

## Metrics

With estimated contribution value `V(i,j)` and investment `I(i,j)`:

| Metric             | Definition                                                    |
| ------------------ | ------------------------------------------------------------- |
| Investment         | `I(i,j) = Σ_t Σ_k p(i,j,k,t) · x(i,j,k,t)`                    |
| Contribution value | `V(i,j) = μ(i,j) · PY(i,j)`                                   |
| Net value          | `V(i,j) − I(i,j)`                                             |
| ROI                | `(V − I) / I`, or 0 if `I = 0`                                |
| BCR                | `V / I`, or 0 if `I = 0`                                      |
| Break-even markup  | `I / PY` when `PY > 0`                                        |
| Sign check         | markup > 1 and net value > 0, or markup ≤ 1 and net value ≤ 0 |

`BCR = ROI + 1` by construction. Investment is summed over all years of the pair and all contribution types, including types that were not given positive weight in the CES estimate.

A pair appears only if it has both a markup and CES parameters.

## Computing PY

`PY(i,j)` is the cost-minimizing expenditure on the pair's contribution portfolio at observed prices: the `P · Y` of [The model](../model/#stage-2-ces-allocation), evaluated on the observed data. How it is computed depends on the pair.

### Rescaling the share parameters

Stage 2 estimates `α` against scale-normalized quantities `x / x̄(k)`. Inference works on raw quantities, so the shares must be rescaled. The cost-minimization condition (★) holds in both units:

```text
normalized:   (x(k)/x̄(k)) / (x(0)/x̄(0))  =  (α(k)/α(0)) · (p(0)/p(k))^σ
raw:          x(k) / x(0)                 =  (α̃(k)/α̃(0)) · (p(0)/p(k))^σ
```

Matching the two gives `α̃(k) ∝ α(k) · x̄(k)`. Renormalizing so the shares sum to one,

```text
α̃(k) = α(k) · x̄(k) / Σ_l α(l) · x̄(l)
```

Only types with `α(k) > 0` are kept as active.

### Simple branch

Pairs with one active type, with an undefined `σ`, or with `σ = 1` use

```text
PY(i,j) = Σ_t Σ_k p(i,j,k,t) · x(i,j,k,t)
```

so `PY = I` and ROI `= μ − 1`.

### CES branch

For all other pairs, let `ȳ(k)` and `p̄(k)` be the quantity and price of type `k` averaged over years. Then

```text
P(i,j)  = [ Σ_k  α̃(k) · p̄(k)^(1−σ) ] ^ ( 1/(1−σ) )
Y(i,j)  = [ Σ_k  α̃(k)^(1/σ) · ȳ(k)^((σ−1)/σ) ] ^ ( σ/(σ−1) )
PY(i,j) = P(i,j) · Y(i,j)
```

Details:

- Averages are over _complete_ years (every active type present) if the pair has at least 2 of them, and over all years otherwise.
- Each of the two bracketed sums is floored at 10⁻⁶ to avoid zero or negative bases.
- A pair is dropped from the CES branch if any active type has no observation.

### Scale of value versus investment

For CES pairs, `PY` is computed from period-average quantities and prices, so it is on a **per-average-period** scale. Investment `I` is the **total** across all years. For the simple branch both are totals. Compare ROI across pairs with different numbers of active years with this in mind.

> **Note:** The research methodology aggregates over time differently: value is summed period by period, `V(i,j) = μ(i,j) · Σ_t P(i,j,t) · Y(i,j,t)`, so value and investment cover the same periods.

## Annualization

The yearly breakdown splits each pair's totals across years in proportion to expenditure:

```text
s(i,j,t) = Σ_k p(i,j,k,t) · x(i,j,k,t) / I(i,j)

V(i,j,t)   = s(i,j,t) · V(i,j)
I(i,j,t)   = s(i,j,t) · I(i,j)
net(i,j,t) = s(i,j,t) · net(i,j)
```

so the ROI in every year of a pair equals the pair's overall ROI. Annual figures show when the money was spent and how the total is spread. They are not a separate estimate of value per year.

## Research methodology: additional constructs

The following appear in the research methodology and are **not** in the product.

### Allocative efficiency

By CES duality, `P(i,j,t) · Y(i,j,t) ≤ Σ_k p(i,j,k,t) · x(i,j,k,t)`, with equality when the observed mix matches the fitted allocation. Defining allocative efficiency as `E(i,j) = Σ_t P·Y / I`, which lies in [0, 1],

```text
BCR(i,j) = μ(i,j) × E(i,j)
```

so the benefit-cost ratio is the markup, discounted by how far the observed allocation is from the cost-minimizing one.

### Participation constraint

An organization that keeps contributing values participation at least at cost: `μ(i,j) · Σ_t P·Y ≥ I(i,j)`. The calibrated markup does not condition on allocative efficiency, so it can fall below the break-even markup `I / Σ_t P·Y`. In that case the methodology raises the markup to break-even and flags the pair, so its ROI of zero reads as a lower bound ("at least break-even"). In the product, markups are not floored, so some pairs have negative ROI, and the sign check is a consistency diagnostic only.

### Mechanism analysis

Once ROI is computed, associations with external characteristics (industry, project category and maturity, organization size, geography) can be explored with a model of the form `ROI = f(drivers)`, for example with a Shapley decomposition. This is correlational: organizations select into projects, and some mechanisms are unobserved.

### Counterfactual analysis

Given `α`, `σ`, and `μ`, the methodology evaluates alternative portfolios (for example, 10% more code, doubling governance participation, or dropping a membership) by recomputing value at the counterfactual quantities, with `μ` and prices held constant, and comparing it to actual value.

## Related reading

- [Interpreting results](../interpreting-results/)
- [The model](../model/)
- [Stage 2: CES allocation](../stage-2-ces/)
