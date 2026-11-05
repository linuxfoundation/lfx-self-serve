---
title: ROI metrics
description: Start here to learn how the Company Lens ROI Metrics page estimates your company's investment and return, what the figures mean, and where to find the data, the value drivers, and the full model.
audience: [all]
product_area: Dashboards
tags: [company lens, roi, return on investment, investment, return, value drivers, estimation method, markup]
last_updated: 2026-11-05
intercom_collection: Dashboards
---

The **ROI Metrics** page in Company Lens (route: `/company/roi`) estimates what your company invests in Linux Foundation projects through its public contribution activity, and the economic return associated with those projects. Find it in the **LF Staff Only** section at the bottom of the Company Lens menu. Only Linux Foundation staff can see that section or open the page.

The estimates come from the LFX Open Source Software (OSS) Contribution ROI model. This section explains it at four levels, so you can stop at whichever one answers your question. If you are new, start with the first three pages in the table.

## Where to start

Pages are ordered from plain-language overviews, to the data, to the value drivers, to the technical description. Every page in this section is listed here.

| Level             | Page                                                        | What you will learn                                                                                                             |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**      | [How the model works](./how-it-works/)                      | The idea behind the model in plain language: how actions reveal value, and the three steps from data to ROI                     |
| **Overview**      | [Interpreting results](./interpreting-results/)             | What each figure on the page means, how to read it, which companies are shown, and where the estimates have limits              |
| **Overview**      | [ROI FAQ](./faq/)                                           | Quick answers: how value is quantified, who the model applies to, how often it updates                                          |
| **Data**          | [Data overview](./data-overview/)                           | What data goes in, the contribution types, which company-project pairs are modelled, and known limitations                      |
| **Data**          | [Contribution labor and time costs](./contribution-labor/)  | How staff time becomes full-time-equivalent effort and a dollar cost, and the hours assigned to each activity type              |
| **Data**          | [Financial expenditures](./financial-expenditures/)         | How memberships, events, sponsorships, and training are counted                                                                 |
| **Value drivers** | [Value drivers](./value-drivers/)                           | How to read the Value drivers chart: what a bar means, the five categories, how far to trust it, and the measurements behind it |
| **Technical**     | [Technical model description](./model/)                     | The economic model: notation, setup, and the assumptions the estimates rest on                                                  |
| **Technical**     | [Stage 1: markups](./stage-1-markups/)                      | How participation histories become a markup for each company-project pair                                                       |
| **Technical**     | [Stage 2: CES allocation](./stage-2-ces/)                   | How the model estimates how contribution types substitute for one another                                                       |
| **Technical**     | [Inference](./inference/)                                   | How markups and allocations become value, ROI, BCR, and the yearly view                                                         |
| **Technical**     | [Value driver decomposition](./value-driver-decomposition/) | The method behind the chart: the driver taxonomy, proxies and controls, the Shapley decomposition, and how much it explains     |
| **Technical**     | [Methodology decisions](./methodology-decisions/)           | Why the model makes the choices it does: counting rules, the participation floor, scale control, and the display gate           |
| **Technical**     | [Model settings and defaults](./model-settings/)            | The fixed settings the model runs with: window, cost rates, calibration, and the display gate                                   |

## What the figures mean

These are short definitions. [Interpreting results](./interpreting-results/) explains each in full.

- **Total investment** — your company's public contribution activity (commits, community participation, meetings, events, memberships, and training), priced at standard rates that are the same for every company. No individual's or company's actual salary or payroll data is used.
- **Total return** — the economic value your company received back from the projects it contributed to, estimated from the wider project ecosystem rather than measured from your own systems.
- **Net return** — total return less investment. Net return is never negative: a net return of zero means the project returned at least what it cost.
- **ROI** — net return divided by investment, shown as a percentage. Blank when there is no investment to divide by.
- **BCR** — total return divided by investment (benefit-cost ratio). Note that BCR = ROI + 1.
- **Value drivers** — which kinds of value make your portfolio's return higher or lower than a typical company-project pair. See [Value drivers](./value-drivers/).

Return is shown for one of two markup methods, **Logistic markup** (the default) or **Direct markup**, chosen in **Model assumptions** on the page. See [Stage 1: markups](./stage-1-markups/) for how they differ.

## How the pieces fit

The model works in three layers, from data to estimates. The technical pages follow the same layers.

```text
Data                         Model and estimation              Inference
─────────────────────        ───────────────────────────       ──────────────────────
Contribution frequency  ──►  Stage 1: markups             ──►  Contribution value
Contribution levels     ──►  Stage 2: CES allocation      ──►  Investment
Cost and spend data                                            ROI, BCR, net value
```

The value drivers chart then explains the stage 1 markup: where a company's value comes from.

## What is and is not in the product

The model began as a research methodology, and the ROI page implements most of it. Counterfactual analysis (what a different contribution portfolio would have returned) is not part of the product. Of mechanism analysis, only the [value driver decomposition](./value-driver-decomposition/) of the markup is implemented. The technical pages mark each place where the research version and the product differ.

## Related sections

- [Dashboard](../dashboards/)
- [Company](../company/)
