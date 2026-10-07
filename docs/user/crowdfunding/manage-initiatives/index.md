---
title: Manage Initiatives
description: How to view initiative details, edit settings, and archive or activate an initiative in LFX Self Serve.
audience: [all]
product_area: Crowdfunding
tags: [crowdfunding, initiatives, manage, edit, archive, activate]
last_updated: 2026-07-21
intercom_collection: Crowdfunding
---

This article explains how to edit, archive, and activate crowdfunding initiatives you own in LFX Self Serve. Select an initiative from the [View Initiatives](../view-initiatives/) page to open its detail page, where you can review financials, edit settings, and change the initiative's status.

## Before you begin

- Sign in to LFX Self Serve at [app.lfx.dev](https://app.lfx.dev) with your Linux Foundation account.
- You must have created at least one crowdfunding initiative. These steps apply to initiative owners only.

## Initiative detail page

The detail page is organized into a header and two tabs.

**Header** shows:

- Initiative name and fund type — see [Fund types](#fund-types) below
- Description and industry tags
- Initiative logo or fund-type icon
- Current status badge

**Overview tab** — sponsors, financial summary, and announcements.

**Financials tab** — detailed funding goals, distribution breakdown, and transaction history.

## Edit an initiative

1. Open an initiative from the [View Initiatives](../view-initiatives/) page.
1. Select **Edit Initiative** to open the settings drawer.
1. Update fields across the settings tabs:
   - **Initiative Details** — name, description, topics, website URL
   - **Branding** — logo image
   - **Beneficiaries** — add or remove by name and email
   - **Funding** — goal amount and distribution percentages across Development, Marketing, Meetups, Bug Bounty, Travel, and Documentation
   - **Sponsorship Tiers** — choose a donation option (open amount or tiered), then configure the goal and benefits for each enabled tier
   - **Announcements** — add, edit, or delete announcements shown to sponsors on the initiative's Overview tab
1. Save your changes.

> **Note:** The Announcements tab isn't part of the drawer's shared Save step. Each add, edit, or delete uses its own **Add**, **Save**, or delete-confirmation action and takes effect right away, independent of the drawer's Save button.

## Archive an initiative

Archiving an initiative changes its status to Hidden. The initiative no longer appears publicly and stops accepting new donations. All active recurring donations to the initiative are cancelled, so donors are not charged again. This cannot be undone: if you later reactivate the initiative, donors must subscribe again. See [Manage Recurring Donations](../manage-recurring-donations/) for how donors manage a subscription.

1. Open a **Published** initiative from the [View Initiatives](../view-initiatives/) page.
2. Select the **More** menu (⋯) in the initiative header.
3. Select **Archive Initiative**.
4. Confirm the action.

The initiative moves to the **Archived** group in the initiatives list.

## Activate an archived initiative

Activating an initiative changes its status back to Published. The initiative becomes publicly visible and resumes accepting donations. Recurring donations cancelled while it was archived are not restored.

1. Open an **Archived** initiative from the [View Initiatives](../view-initiatives/) page.
2. Select the **More** menu (⋯) in the initiative header.
3. Select **Activate Initiative**.
4. Confirm the action.

The initiative moves to the **Active** group in the initiatives list.

> **Note:** The **More** menu is only available for Published or Archived initiatives. Initiatives with a Pending or Submitted status do not have status-change actions available.

## Fund types

Each initiative has a fund type that describes its purpose:

- **General Fund** — supports the project's general development and operating expenses
- **Security Audit** — funds a third-party security review or penetration test of the project's code
- **Mentorship** — funds a mentorship program that trains new contributors to the project
- **Event** — funds a conference, summit, or community event organized around the project

## Frequently asked

**What happens to recurring donors when I archive an initiative?**
Archiving an initiative stops it from accepting new donations and cancels all active recurring donations to it. Donors are not charged again, and they must subscribe again if you reactivate the initiative.

**Can I reactivate an archived initiative?**
Yes. An archived initiative can be reactivated at any time by selecting **Activate Initiative** from the **More** menu (⋯). The initiative will return to Published status and resume accepting donations.

**Why can't I see the More menu on my initiative?**
The **More** menu for archiving and activating is only available for initiatives with a Published or Archived (Hidden) status. Initiatives that are Pending or Submitted are still under review and cannot be manually archived or activated until the review is complete.

## Related

- [View Initiatives](../view-initiatives/) — browse and filter your full list of initiatives
- [My Donations](../my-donations/) — view your donation history and manage payment methods
