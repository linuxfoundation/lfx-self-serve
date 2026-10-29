---
title: Foundation Health Metrics
description: Foundation-level health metrics — the health cards on the Foundation overview and the dedicated Health Metrics page.
audience: [all]
product_area: Dashboards
tags: [dashboard, foundation, health-metrics, organization-dependency]
last_updated: 2026-10-29
intercom_collection: Dashboards
---

The **Foundation** lens surfaces foundation-level health metrics in two places: the health section of the **Foundation overview** (`/foundation/overview`) and the dedicated **Health Metrics** page (`/foundation/health-metrics`). This article explains both.

## Health metrics on the Foundation overview

The Foundation overview shows a row of health metric cards — including total value of projects, total projects, active members, project health scores, active contributors, maintainers, and events. Selecting an available card opens a drawer with charts and additional detail.

### Unavailable metrics

Cards load independently. A missing or failed metric does not hide other available Foundation Health cards.

- **Data not available yet** means analytics data for that metric is not available for the selected foundation. It is not shown as a measured zero, and this state does not offer Retry.
- **This metric could not be loaded** means the request failed. Select **Retry** on that card to retry its failed request without reloading successful metrics.
- **You do not have access to this metric** is an access restriction. Contact your administrator if you need access.
- **Access could not be verified** means access could not be checked temporarily. Select **Retry** to check again.

If a headline metric is available but its supporting data fails, the measured value remains visible with **Additional details are unavailable**. The drawer stays unavailable until its required data loads successfully; Retry only reloads the failed supporting requests.

### Organization Dependency

The Foundation overview includes an **Organization Dependency** card among its health metrics. It shows how concentrated contributions are across organizations: the group of organizations whose contributors performed 51% or more of all contributions, compared with all other organizations.

Select the card to open a drawer with the top-organization count, a chart comparing that group's contribution share against all other organizations, and a link to detailed contribution metrics in LFX Insights.

The card is visible to board members, executive directors, LF Staff, users with a writer role on the foundation (including root writers), and users with tenant-wide auditor access.

## Health Metrics page

The **Health Metrics** page (`/foundation/health-metrics`) is available to executive directors and LF Staff from **Metrics → Health Metrics** in the left navigation. Use the year filter at the top of the page to switch between **year to date (YTD)** and completed calendar years. The page includes:

- **Participating Organizations** — active and new member organizations by engagement level
- **Net Promoter Score** — member satisfaction from NPS surveys
- **Membership Churn Per Tier** — churn rate, members lost, and value lost by membership tier
- **Outstanding Balance** — unpaid membership invoices
- **Events** — total, upcoming, and past events, plus sponsorship progress toward goal
- **Training & Certification** — training enrollment and revenue by program type
- **Code Contribution** — total and new contributors, plus all-time committer, maintainer, and reviewer counts
- **Board Meeting Participation** — board meeting attendance

## Related

- [Dashboard overview](../) — lens and persona concepts
- [Navigate Your Dashboard](../navigate-dashboards/) — switch lenses and project context
- [Social Listening](../../social-listening/) — foundation social sentiment and mentions
