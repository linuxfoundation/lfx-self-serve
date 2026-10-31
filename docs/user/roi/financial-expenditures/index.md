---
title: Financial expenditures
description: How the ROI model counts direct spending — memberships, event attendance, event sponsorships, and training — and why some types are treated as fixed units.
audience: [all]
product_area: Dashboards
tags: [roi, expenditures, memberships, events, sponsorships, training, fixed unit]
last_updated: 2026-10-30
intercom_collection: Dashboards
---

Direct spending is recorded in dollars and used as observed. Each source is aggregated by organization account, project, and calendar year, then mapped to the organization through the account mapping.

## Memberships

Each paid membership's amount is spread across the calendar years of its real term, in proportion to the number of days of the term that fall in each year:

```text
amount(y) = price × (days of the term falling in year y) / (days in the term)
```

- The term runs from the membership's **install date** to the earlier of its end date and the install date plus its recorded membership length. Memberships whose end date is recorded as open-ended still get their real term from the membership length. A non-positive term falls back to 12 months from the install date.
- Every year of the term is covered, not just two, so a membership's yearly amounts always add up to its paid price.
- The membership's start date is not used. On renewals it is often overwritten with a later line-item date, which would stack several years of fees into one year.
- Only memberships with a positive paid price are counted.

Money is credited once, to the project that sold it. A foundation's own membership belongs to the foundation, and its sub-projects are separate. See [Counting each resource once](../data-overview/#counting-each-resource-once).

- **Project membership:** every membership except the Linux Foundation one, attributed to the project it belongs to. Quantity is 1 and price is the apportioned amount.
- **Linux Foundation membership:** the organization's foundation-wide fee is divided equally among its **key projects** and assigned to each, so it sums to the fee and is not copied. Organizations with no key projects get no Linux Foundation membership cost. Quantity is 1 and price is the share per project.

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
