---
title: Financial expenditures
description: How the ROI model counts direct spending — memberships, event attendance, event sponsorships, and training — and why some types are treated as fixed units.
audience: [all]
product_area: Dashboards
tags: [roi, expenditures, memberships, events, sponsorships, training, fixed unit]
last_updated: 2026-10-16
intercom_collection: Dashboards
---

Direct spending is recorded in dollars and used as observed. Each source is aggregated by organization account, project, and calendar year, then mapped to the organization through the account mapping.

## Memberships

A membership term is 12 months from its start date. The fee is split between the two calendar years the term touches, in proportion to the number of days in each year:

```text
fee(y) = price × (days of the term falling in year y) / (days in the term)
```

Only memberships with a positive paid price are counted.

- **Project membership:** every membership except the Linux Foundation one, attributed to the project it belongs to. Quantity is 1 and price is the pro-rated amount.
- **Linux Foundation membership:** the organization's foundation-wide fee is divided equally among its **key projects** and assigned to each. Organizations with no key projects get no Linux Foundation membership cost. Quantity is 1 and price is the share per project.

## Event attendance

Only paid registrations tied to a project are counted.

- Net revenue is converted to USD with a fixed exchange-rate table. Registrations in currencies not in the table are excluded.
- Quantity is the number of distinct registrations in the year.
- Price is the average USD net revenue per registration plus an **event overhead** of $3,000 per attendee, a stand-in for travel and time away.

## Event sponsorship

Sponsorships with a positive price in USD are counted. Sponsorships in a year are summed, quantity is 1, and price is the total sponsorship amount.

## Education and training

Quantity is units sold in the year. Price is the **median** net revenue per unit across purchases, so a few unusually priced purchases do not dominate.

## Fixed-unit types

Sponsorships and memberships are annual commitments rather than quantities that scale. The model records them as a single unit with the dollar amount as price. In estimation, these types use expenditure-share information instead of quantity ratios. See [Stage 2: CES allocation](../stage-2-ces/).

## Related reading

- [Contribution labor](../contribution-labor/)
- [Data overview](../data-overview/)
