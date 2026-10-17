---
title: How the ROI model works
description: A plain-language explanation of the LFX contribution ROI model, with no math required — revealed preference, the three steps, and what the model does and does not measure.
audience: [all]
product_area: Dashboards
tags: [roi, intuition, revealed preference, markup, how it works]
last_updated: 2026-10-16
intercom_collection: Dashboards
---

This page explains the approach in plain language. No math is needed. The [technical section](../model/) has the formulas.

## The question

Organizations spend real money and staff time on open source: engineers write code, staff join project meetings, companies pay membership fees, sponsor events, and send people to conferences. The model asks:

- How much value does an organization get from this contribution?
- How does that value compare with what it costs?
- How does this differ across organizations, projects, and kinds of contribution?

## The core idea: actions reveal value

We cannot see the value an organization gets from open source. It might be better products, access to innovation, hiring, influence over a project's direction, or lower risk. Organizations rarely report it, and it differs for each.

We _can_ see what organizations do. The idea is called [revealed preference](https://en.wikipedia.org/wiki/Revealed_preference):

> If an organization keeps investing time and resources in a project, year after year, across several kinds of contribution, then the project is probably worth at least what it costs.

For example, if Company X invests heavily in Project Y every year in code, meetings, and sponsorship, we infer it sees a positive return on that investment. If the investment were not worthwhile, it would likely have stopped.

This is an assumption, albeit an important one and the basis of the entire model. It implies further assumptions: that organizations are rational, have consistent preferences over time, and have good information. It may not hold in every case, but it gives a useful starting point for estimating perceived value from observable behavior.

An advantage of this approach is that the model does not need to know _why_ an organization contributes. It does not assume any particular benefit. It uses the pattern of behavior to estimate how much value the organization must perceive. That lets the model generalize across organizations, projects, and types of contribution without knowing the motivation behind each action.

## Three steps

```text
1. Measure the investment  →  2. Infer perceived value  →  3. Compute the return
   (data)                       (model and estimation)        (inference)
```

**1. Measure the investment.** Every resource an organization puts into a project is converted into dollars.

- Money spent directly (membership fees, sponsorships, event tickets, training courses) is used as recorded.
- Staff time is estimated from activity records such as commits, pull requests, issues, and meeting attendance. Each activity type is assigned an estimated number of hours, converted to full-time-equivalent (FTE) effort, and valued at a typical salary.

**2. Infer perceived value from behavior.** The model looks at two things:

- _Whether_ an organization contributes to a project, and how consistently over time. Organizations that contribute more persistently reveal more perceived value. This yields a **markup**: the value perceived per dollar of direct cost. A markup of 1 means break-even. A markup of 3 means the organization behaves as if each dollar returns about three dollars of value.
  - The model recovers a ranking of organization-project pairs by two methods (a logistic regression and a direct ranking by activity rate). The ranking is then converted to markups using survey data from the LF Research [ROI for Open Source Software Contribution](https://www.linuxfoundation.org/research/contribution-roi) survey.
- _How_ it spreads its effort across contribution types. This shows which types matter most for a given organization and how easily it swaps one type for another.

**3. Compute the return.** The markup is applied to the cost of the contribution portfolio to get an estimated **contribution value**. Comparing value with investment gives ROI and the benefit-cost ratio.

## Why the markup is calibrated, not just estimated

Behavior can rank organization-project pairs by how much they seem to value a project, but it cannot by itself say how large the value is in dollars. To put the ranking on a dollar scale, the model maps it onto a distribution of markups anchored to external evidence from the LF Research Open Source ROI Survey. Pairs that look most committed get the highest markups. The ordering comes from behavior. The overall level comes from the survey.

So the overall scale of contribution ROI is not pulled out of thin air. The model is grounded in observable behavior and anchored to returns reported by the community. The estimates are therefore both behaviorally informed and empirically anchored.

## What the model is and is not

- **Mechanism agnostic.** It does not claim contribution pays off through any one channel.
- **A measure of what organizations invest.** It values the cash and time organizations put in. It does not estimate the value of the software itself, unlike COCOMO-style methods that price lines of code.
- **Applicable to any organization type.** It only assumes organizations act in line with their goals.
- **Model-based.** Estimates are useful for comparison and for seeing the scale of an investment. They are not audited accounting figures. See [Interpreting results](../interpreting-results/).
- **Silent on use value.** The overwhelming majority of OSS users do not contribute at all, yet obviously derive value from using the software. The ROI model focuses solely on the perceived value of _contributing_, not of _using_, the software. In this sense, contribution ROI _underestimates_ the total value generated by open source projects.

## Related reading

- [Interpreting results](../interpreting-results/)
- [ROI FAQ](../faq/)
- [Data overview](../data-overview/)
- [The model (technical)](../model/)
