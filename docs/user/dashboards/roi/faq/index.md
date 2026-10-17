---
title: ROI FAQ
description: Frequently asked questions about the LFX contribution ROI model — how value is quantified, who it applies to, what it captures, and how often it updates.
audience: [all]
product_area: Dashboards
tags: [roi, faq, revealed preference, cocomo, markup]
last_updated: 2026-10-16
intercom_collection: Dashboards
---

## How can the model quantify the "value" of open source contribution?

The model uses _revealed preference_. Organizations take actions to maximize the benefit they receive from OSS contributions, so their contribution behavior and prioritization indicate how large those benefits must be to justify the decisions. Combined with real contribution history, this lets us recover estimates of contribution value and ROI. See [How the model works](../how-it-works/).

## My organization is not a profit-maximizing company. Can the model still be applied?

Yes. The model is agnostic to the type of organization. It assumes only that the organization behaves in a way that furthers its objectives. It applies to non-profits, foundations, public sector organizations, and companies alike. If an organization contributes to open source, the model assumes it perceives value from doing so, even if that value is not directly financial or related to the bottom line. The requirement is a consistent contribution history that can be observed and quantified in monetary terms.

## What types of contribution value does the model capture?

The model does not specify the form value takes, as long as it can be expressed in money. Value could be increased revenue, reduced production cost, or intrinsic or social value.

## Does the model use COCOMO to derive value for open source projects?

No. The model measures the _input_ side: what an organization spends, either directly (fees, tickets, sponsorships) or as the cost of staff time converted from observed activity. See [Data overview](../data-overview/).

## Does the model imply that we should just contribute to the project with the greatest ROI?

No. The model does not capture complementarities between projects, so it can understate the overall ROI of a portfolio ("the sum is greater than the parts").

## How often can the value metrics be updated?

Daily. When new contribution activity data is available, the value metrics are updated accordingly. Some parameters do not change on a daily basis and are updated less frequently, such as the markup distribution and the CES parameters.

## Where do the hours per activity come from?

From a table of domain-knowledge estimates with low, medium, and high scenarios, not from measurements of individual developers. See [Activity time costs](../activity-time-costs/).

## Related reading

- [Interpreting results](../interpreting-results/)
- [The model (technical)](../model/)
