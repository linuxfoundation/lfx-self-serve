---
title: Inference
description: How the ROI model combines markups, CES parameters, and observed spending into contribution value, ROI, BCR, and annual figures — with the research constructs that are not in the product.
audience: [all]
product_area: Dashboards
tags: [roi, inference, bcr, break-even, annualization, technical]
last_updated: 2026-10-30
intercom_collection: Dashboards
---

The inference layer combines the stage 1 markups, the stage 2 CES parameters, and observed quantities and prices into ROI metrics. Results are produced for each organization-project pair and each markup method, with a yearly breakdown.

## Metrics

With estimated contribution value `V(i,j)` and investment `I(i,j)`:

| Metric             | Definition                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Investment         | `I(i,j) = Σ_t Σ_k p(i,j,k,t) · x(i,j,k,t)`                                                             |
| Contribution value | `V(i,j) = μ(i,j) · PY(i,j)`, with the markup floored at break-even (see [below](#participation-floor)) |
| Net value          | `V(i,j) − I(i,j)`                                                                                      |
| ROI                | `(V − I) / I`; undefined if `I = 0` (reported as 0 in the model output, shown blank on the ROI page)   |
| BCR                | `V / I`; undefined if `I = 0` (reported as 0 in the model output, shown blank on the ROI page)         |
| Break-even markup  | `I / PY` when `PY > 0`                                                                                 |
| Sign check         | markup > 1 and net value ≥ 0, or markup ≤ 1 and net value ≤ 0                                          |

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

Matching the two gives

```text
α̃(k) = α(k) · x̄(k)
```

Only types with `α(k) > 0` are kept as active. `P · Y` does not change when every share is multiplied by the same constant, so the rescaled shares need not be renormalized. A year in which only some types are present can use the pair's `α̃` for the types present directly.

### Simple branch

Pairs with one active type, with an undefined `σ`, or with `σ = 1` use, in each year `t`,

```text
PY(i,j,t) = Σ_k p(i,j,k,t) · x(i,j,k,t)
```

so `PY(i,j) = Σ_t PY(i,j,t) = I(i,j)`.

### CES branch

For all other pairs, value is computed year by year and then summed. In year `t`, let `K(t)` be the types present that year, with quantity `x(k,t)` (summed over the year) and price `p(k,t)` (quantity-weighted, so that `p · x` reproduces the year's spending exactly). Then

```text
P(i,j,t)  = [ Σ_{k in K(t)}  α̃(k) · p(k,t)^(1−σ) ] ^ ( 1/(1−σ) )
Y(i,j,t)  = [ Σ_{k in K(t)}  α̃(k)^(1/σ) · x(k,t)^((σ−1)/σ) ] ^ ( σ/(σ−1) )
PY(i,j,t) = P(i,j,t) · Y(i,j,t)

PY(i,j)   = Σ_t PY(i,j,t)
```

Details:

- A year with a single type reduces to `p · x`, the year's spending.
- A year contributes zero value if either bracketed sum is not positive.
- By CES duality `PY(i,j,t) ≤ Σ_k p(k,t) · x(k,t)` in every year, with equality when that year's mix satisfies the first-order conditions for the pair's `α` and `σ`.

Value and investment are therefore both sums over the same years, so ROI is comparable across pairs with different numbers of active years.

## Participation floor

An organization that keeps contributing values participation at least at its cost: `μ(i,j) · PY(i,j) ≥ I(i,j)`. The calibrated markup `μ_raw` comes from ranking pairs by participation and does not condition on allocative efficiency, so it can fall below the break-even markup `I / PY`. Inference enforces the constraint:

```text
μ(i,j)  = max( μ_raw(i,j),  I(i,j) / PY(i,j) )
V(i,j)  = μ(i,j) · PY(i,j)          (so V ≥ I)
```

A pair whose raw markup is raised is **floored**. A floored pair has `V = I`, so its net value and ROI are exactly 0 and its BCR is 1. **A floored pair's ROI of 0 is a lower bound: the pair contributes at least at break-even.** It is not a point estimate.

If `PY(i,j) = 0` there is no finite break-even markup, so the markup stays at `μ_raw`, but positive investment still floors the return at cost, so net value and ROI are again exactly 0.

Consequences:

- **ROI is never negative.** Every pair has `V ≥ I`.
- Only pairs whose raw markup would contradict the revealed-preference assumption are changed. The ranking and calibration of every other pair are untouched.
- The identity below uses the floored markup for pairs with positive `PY`.

### Allocative efficiency

By CES duality, `PY(i,j) ≤ I(i,j)`, with equality when the observed mix matches the fitted allocation. Define allocative efficiency as `η(i,j) = PY(i,j) / I(i,j)`, which lies in [0, 1]. For pairs with positive `PY`,

```text
BCR(i,j) = μ(i,j) × η(i,j)
```

so the benefit-cost ratio is the markup, discounted by how far the observed allocation is from the cost-minimizing one.

## Annualization

The yearly breakdown splits each pair's totals across years in proportion to expenditure:

```text
ω(i,j,t) = Σ_k p(i,j,k,t) · x(i,j,k,t) / I(i,j)

V(i,j,t)   = ω(i,j,t) · V(i,j)
I(i,j,t)   = ω(i,j,t) · I(i,j)
net(i,j,t) = ω(i,j,t) · net(i,j)
```

so the ROI in every year of a pair equals the pair's overall ROI. Annual figures show when the money was spent and how the total is spread. They are not a separate estimate of value per year.

## Research methodology: additional constructs

The following appear in the research methodology and are **not** in the product. The participation floor and allocative efficiency, which the research methodology also describes, are implemented and covered above.

### Mechanism analysis

Once ROI is computed, associations with external characteristics (industry, project category and maturity, organization size, geography) can be explored with a model of the form `ROI = f(drivers)`, for example with a Shapley decomposition. This is correlational: organizations select into projects, and some mechanisms are unobserved.

### Counterfactual analysis

Given `α`, `σ`, and `μ`, the methodology evaluates alternative portfolios (for example, 10% more code, doubling governance participation, or dropping a membership) by recomputing value at the counterfactual quantities, with `μ` and prices held constant, and comparing it to actual value.

## Related reading

- [Interpreting results](../interpreting-results/)
- [The model](../model/)
- [Stage 2: CES allocation](../stage-2-ces/)
