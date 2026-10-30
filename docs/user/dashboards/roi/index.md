---
title: ROI metrics
description: How the Org Lens ROI page estimates your organization's investment in Linux Foundation projects and the return associated with it.
audience: [all]
product_area: Dashboards
tags: [org, org lens, roi, return on investment, investment, return, estimation method, markup]
last_updated: 2026-10-30
intercom_collection: Dashboards
---

The **ROI Metrics** page in Org Lens estimates what your organization invests in Linux Foundation projects through its public contribution activity, and the economic return associated with those projects.

Find the page in the **LF Staff Only** section at the bottom of the Org Lens menu. Only Linux Foundation staff can see that section or open the page.

Full documentation of the ROI model is being written. This page summarizes what the ROI page itself states.

## What the figures mean

- **Total investment** — your organization's public contribution activity (commits, community participation, meetings, events, memberships, and training), priced at standard rates that are the same for every organization. No salary, payroll, or invoice data is used.
- **Total return** — the economic value your organization received back from the projects it contributed to, estimated from the wider project ecosystem rather than measured from your own systems.
- **Net return** — total return less investment. A project can have a negative net return when it returned less than it cost.
- **ROI** — net return divided by investment, shown as a percentage. Blank when there is no investment to divide by.
- **BCR** — total return divided by investment (benefit-cost ratio). Always exactly one more than ROI.

## Estimation method

Return is estimated with one of two markup methods, chosen in **Model assumptions** on the ROI page:

- **Logistic markup** — the default.
- **Direct markup**

The choice applies to every figure on the page and is remembered on the device you choose it on. Both methods draw on the same investment base, so switching moves the figures modestly rather than dramatically.

## Cost rates

The rates used to price contribution activity are global constants: one rate per contribution type, applied identically to every organization. They are not specific to your organization and are not derived from anyone's actual or reported compensation. They are set in the data pipeline, so the figures on the page cannot be recalculated with different values.

## Related sections

- [Dashboard](../index.md)
