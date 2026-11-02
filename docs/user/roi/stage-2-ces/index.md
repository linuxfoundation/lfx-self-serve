---
title: 'Stage 2: CES allocation'
description: How the ROI model estimates, for each organization-project pair, how contribution types substitute for one another — moment conditions, estimator, closed-form elasticity, share recovery, and the pooled prior.
audience: [all]
product_area: Dashboards
tags: [roi, ces, elasticity of substitution, gmm, moment conditions, technical]
last_updated: 2026-10-30
intercom_collection: Dashboards
---

Stage 2 estimates, for each organization-project pair, the CES share of each contribution type `α(k)` and the elasticity of substitution `σ`. It uses the yearly quantities and prices of each type from the [contribution levels](../data-overview/#contribution-levels-stage-2-and-inference-input) data and runs for the pairs that received a markup in [stage 1](../stage-1-markups/).

## Moment conditions

From the cost-minimization condition (★) in [The model](../model/#stage-2-ces-allocation), for a reference type 0 and any other **flexible** type `k` (a type whose quantity scales), each year `t` gives the moment

```text
g(k,t) = log( x(k,t) / x(0,t) ) − log( α(k) / α(0) ) − σ · log( p(0,t) / p(k,t) ) = 0
```

The model is estimated one pair at a time, so the `i,j` subscripts are dropped on this page.

**Fixed-unit types** (event sponsorship, project membership, Linux Foundation membership) have quantity fixed at 1, so quantity ratios carry no information. They use the same condition in expenditure-share form. From (★), `x(k) = α(k) · p(k)^(−σ) · c` for a common scalar `c`, so `p(k)·x(k) = c · α(k) · p(k)^(1−σ)` and

```text
p(k)·x(k) / Σ_l p(l)·x(l)   =   α(k) · p(k)^(1−σ) / Σ_l α(l) · p(l)^(1−σ)
```

This keeps every `α(k)` on a single scale.

## Estimator

The estimator chooses `(α, σ)` to make the per-year first-order conditions hold as closely as possible, by least squares:

```text
Q(α, σ) = Σ_t Σ_k  g(k,t)(α, σ)²
```

Each year's squared moments get equal weight. Prices are administratively set (salary benchmarks, posted membership and event rates) and are not treated as endogenous, so no instruments are used: the estimator is the special case of generalized method of moments with a constant instrument, applied to the moments year by year. The model supports real instruments in principle, but none are used.

## Per-pair data preparation

1. **Scale normalization.** Quantities are divided by the global mean quantity of their type, `x̃(k,t) = x(k,t) / x̄(k)`, so types measured in different units (FTE, attendee counts, units of one) are comparable. Prices are not rescaled. The same scale is reapplied in [inference](../inference/#rescaling-the-share-parameters).
2. **Collapse to type and year.** Within a year and type, quantities are summed and prices averaged. Cells with a non-positive quantity are treated as absent.
3. **Active types.** The types that appear for the pair. If only one type is present, the pair gets `α = 1`, no `σ`, and no estimation is done.
4. **Complete years.** A year is _complete_ if every active type is present. With at least **2** complete years, the **panel** estimator uses those years. Otherwise the pair is reduced to a single cross-section by averaging each type over the years in which it appears (the **aggregated** case), and pairs with a non-positive average are dropped.

## Estimating σ

The first flexible active type, in alphabetical order, is the reference type 0.

### All types flexible: closed form

Define `c(k,t) = log( x(k,t) / x(0,t) )` and `e(k,t) = log( p(0,t) / p(k,t) )`, with `c̄(k)` and `ē(k)` their means over years. For any `σ`, the best choice of `log(α(k)/α(0))` is `c̄(k) − σ·ē(k)`, which sets the mean moment for each type to zero. Substituting it back (profiling out the shares) leaves a quadratic in `σ`:

```text
Q(σ) = Scc − 2·Sce·σ + See·σ²

Scc = Σ_k Σ_t ( c(k,t) − c̄(k) )²
Sce = Σ_k Σ_t ( c(k,t) − c̄(k) ) · ( e(k,t) − ē(k) )
See = Σ_k Σ_t ( e(k,t) − ē(k) )²
```

The unconstrained minimizer is `σ* = Sce / See`. Because `σ = 1` makes the CES form degenerate, the feasible set excludes it. By default it is `[0.1, 0.99] ∪ [1.01, 10]`. On each of the two intervals the constrained minimizer is `σ*` clamped to that interval, and the interval with the lower `Q` wins. If `See = 0` (no price variation across years), `σ` is not identified.

### Mixed pairs (fixed-unit types present)

The share moments are nonlinear in `σ`, so a bounded one-dimensional search (Brent's method, tolerance 10⁻⁶) minimizes the full objective on each feasible interval, with the flexible shares profiled out inside the objective. The best result across the intervals is kept.

### Fallbacks

- If fewer than two flexible types are present, the quadratic is not identified, or the search fails, `σ` is set to **0.5**. These pairs are labeled as fallback estimates.
- A single cross-section cannot identify `σ` from price variation over time, so aggregated pairs are re-estimated in pass 2, below, with a pooled prior.

## Recovering α

Every type, fixed-unit or flexible, gets its weight from the same first-order-condition log-ratio identity. Given `σ`, with reference type 0 anchored at 1:

```text
log( α(k) / α(0) ) = (1/T) · Σ_t [ log( x(k,t) / x(0,t) ) − σ · log( p(0,t) / p(k,t) ) ]
```

For fixed-unit types this is the same condition as the expenditure-share moment above, so using one formula keeps every weight on one scale, consistent with the quantity rescaling in [inference](../inference/#rescaling-the-share-parameters). The weights are then **normalized to sum to one first**, only then clipped to `[10⁻⁶, 1 − 10⁻⁶]`, and renormalized. Clipping before normalizing would collapse the reference weight and every heavier weight to the same value. The result is validated: each `α(k)` in (0, 1), `Σ α(k) = 1`, `σ > 0`, and `σ ≠ 1`. Pairs that fail validation are dropped.

## Two-pass pooled elasticity prior

Three kinds of pair cannot identify `σ` on their own:

- **Aggregated pairs**, estimated from a single cross-section, because price variation over time is needed to identify `σ`.
- **Fallback pairs**, where `σ` was set to the fallback value.
- **Corner solutions**, where the best fit lands on an outer bound of the search interval (0.1 or 10). The data reject CES substitution for the pair. For example, quantity ratios move with price ratios, the opposite of substitution.

**Pass 1** estimates every pair on its own. The **prior** is then the geometric mean of `σ` over well-identified pairs:

```text
σ_prior = exp( (1/N) · Σ_(i,j) log σ̂(i,j) )
```

A pair counts as well identified if

- it was estimated with the panel estimator,
- its mean absolute moment residual is below 1.0,
- `σ̂` is strictly inside the bounds (not a corner solution), and
- `σ̂ > 0`.

Corner solutions are excluded from the prior because they would pull it toward the bound. The prior is computed only if at least **10** such pairs exist. **Pass 2** re-estimates all three kinds of pair above with `σ` fixed at the prior, and replaces their pass 1 results. If no prior can be formed, the pass 1 results stand.

The prior is the model's own pooled estimate of substitutability, which is a better choice than an arbitrary constant. Clamping a corner pair at the lower bound instead would impose near-perfect complementarity, which penalizes any year-to-year change in the mix heavily.

## Diagnostics

For each pair the estimation records:

- the value of `Q` at the solution
- the mean and maximum absolute residual of the moments over the flexible types
- the estimation path: panel, aggregated, a fallback, a pooled-prior estimate, or a single-type pair

## Related reading

- [The model](../model/)
- [Stage 1: markups](../stage-1-markups/)
- [Inference](../inference/)
