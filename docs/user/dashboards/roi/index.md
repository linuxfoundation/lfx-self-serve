---
title: ROI metrics
description: How the Org Lens ROI page estimates your organization's investment in Linux Foundation projects and the return associated with it, with guides to the model's intuition, data, and mathematics.
audience: [all]
product_area: Dashboards
tags: [org, org lens, roi, return on investment, investment, return, estimation method, markup]
last_updated: 2026-10-16
intercom_collection: Dashboards
---

The **ROI Metrics** page in Org Lens (route: `/org/roi`) estimates what your organization invests in Linux Foundation projects through its public contribution activity, and the economic return associated with those projects.

The estimates come from the LFX Open Source Software (OSS) Contribution ROI model, which this section documents in full. The model combines contribution data from LFX with a structural economic model, and it estimates the implied return to contribution for every organization-project pair with enough contribution history. This section explains the model at three levels of depth, so you can stop at whichever one answers your question: plain-language guides, the data, and the technical description.

## What the model produces

- **ROI estimates** for every organization-project pair with sufficient contribution history and data
- **Investment**, in dollars, broken down by contribution type (code, community, meetings, events, memberships, and training) and annualized

## What the figures mean

- **Total investment** — your organization's public contribution activity (commits, community participation, meetings, events, memberships, and training), priced at standard rates that are the same for every organization. No salary, payroll, or invoice data is used.
- **Total return** — the economic value your organization received back from the projects it contributed to, estimated from the wider project ecosystem rather than measured from your own systems.
- **Net return** — total return less investment. A project can have a negative net return when it returned less than it cost.
- **ROI** — net return divided by investment, shown as a percentage. Blank when there is no investment to divide by.
- **BCR** — total return divided by investment (benefit-cost ratio). Note that BCR = ROI + 1.

## How the model works

The model works in three layers. Each page below belongs to one of them:

```text
Data                         Model and estimation              Inference
─────────────────────        ───────────────────────────       ──────────────────────
Contribution frequency  ──►  Stage 1: markups             ──►  Contribution value
Contribution levels     ──►  Stage 2: CES allocation      ──►  Investment
Cost and spend data                                            ROI, BCR, net value
```

![Overview of the contribution ROI methodology: data sources feed processed data, which feeds a two-stage model, recovered parameters, and inference](/images/docs/roi-methodology-overview.png)

- **Data sources and processed data.** LFX and Linux Foundation records (platform activity, memberships, events, courses), public project repositories, wage and currency exchange data, and LF Research survey results are turned into processed datasets: contribution frequency (does an organization contribute to a project each month?), contribution levels and expenditures (how much, in units and dollars), organization and project characteristics, and the survey-based ROI calibration.
- **Model.** Two stages. The first models the organization's binary decision to contribute to a project. The second models how much it contributes and how it allocates effort across contribution types.
- **Recovered parameters.** The first stage recovers a strategic importance factor, the markup. The second recovers the allocation and substitution parameters: how much weight each contribution type carries and how easily one substitutes for another. The markup also feeds the second stage.
- **Inference.** The recovered parameters are combined with the processed data to compute ROI. The diagram also shows mechanism analysis and counterfactual analysis. These are part of the research methodology but are not available on the ROI page.

- [how the model works](./how-it-works/) for a high level overview of the three layers and their interactions.
- [technical model description](./model/) for the detailed methodology.
- [Stage 1: markups](./stage-1-markups/) for the first stage of the model, which recovers the strategic importance factor (the "markup").
- [Stage 2: CES allocation](./stage-2-ces/) for the second stage of the model, which recovers the allocation and substitution parameters and uses the markup from the first stage.
- [Inference](./inference/) for how the recovered parameters are combined with the processed data to compute ROI, including mechanism analysis and counterfactual analysis.

## Where to start

Pages are ordered from plain-language guides, to the data, to the technical description.

| If you want to...                                             | Read                                                |
| ------------------------------------------------------------- | --------------------------------------------------- |
| Understand the idea behind the model                          | [How the model works](./how-it-works/)              |
| Know what each number means and where it stops being reliable | [Interpreting results](./interpreting-results/)     |
| Get quick answers to common questions                         | [ROI FAQ](./faq/)                                   |
| See what data goes in and how it is priced                    | [Data overview](./data-overview/)                   |
| Understand how staff time becomes dollars                     | [Contribution labor](./contribution-labor/)         |
| See how memberships, events, and training are counted         | [Financial expenditures](./financial-expenditures/) |
| Check the hours assigned to each activity type                | [Activity time costs](./activity-time-costs/)       |
| Read the full mathematical model and its assumptions          | [Technical model description](./model/)             |
| Look up a default setting                                     | [Model settings and defaults](./model-settings/)    |

## Related sections

- [Dashboard](../)
- [Organization](../../organization/)
