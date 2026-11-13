---
title: Lens-scoped Initiatives
description: View the crowdfunding initiatives run on behalf of a project, foundation, or company you write to in LFX Self Serve.
audience: [all]
product_area: Crowdfunding
tags: [crowdfunding, initiatives, project, foundation, company, attribution, lens]
last_updated: 2026-11-06
intercom_collection: Crowdfunding
---

A crowdfunding initiative can be run on behalf of a project, foundation, or company. LFX Self Serve lists those initiatives under that entity's lens, so its writers can follow fundraising run in its name. The page works like the **Me** lens [Initiatives](../view-initiatives/) page, scoped to the selected entity.

## Who sees it

- **Projects and Foundation lenses** — users who can write to the selected project or foundation.
- **Company lens** — users who are an **Admin** (Org Admin – Editor) of the selected company, granted directly on that company on its [Company Lens Access](../../company/manage-company-lens-access/) tab. Admin access to a parent or other related company does not carry over, and neither does a **Viewer** role.

Other users don't see the navigation item. If they open the page's address anyway, it says **You don't have access to these initiatives**.

## Navigation

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Switch to the **Projects**, **Foundation**, or **Company** lens and select the project, foundation, or company.
3. Select **Crowdfunding Initiatives** from the left navigation sidebar. In the **Company** lens it is directly below **Projects**, and the page address is `/company/<company>/initiatives`.

## What the page shows

The page header reads **Initiatives**, with the description "Fundraising initiatives on LFX Crowdfunding run on behalf of" followed by the entity name. Below it, you get the same stats bar (**Active Initiatives**, **Total Raised**, **Total Sponsors**), the **Active**, **Pending**, and **Archived** filter pills, and the **New Initiative** button as the Me lens page. See [View Initiatives](../view-initiatives/) for details.

Each initiative also shows **Created by** followed by the name of the person who created it, both in the list and at the top of its detail page. This appears only in the **Projects**, **Foundation**, and **Company** lenses, not in the **Me** lens.

Select an initiative to open its detail page. It offers the same tabs and actions described in [Manage Initiatives](../manage-initiatives/), except **Edit attribution**, which is available only to the initiative's creator from the **Me** lens.

## Error states

- **You don't have access to these initiatives** — only writers on the project or foundation, or Admins granted directly on the company, can see the initiatives run on its behalf. Ask an administrator of the project or foundation for write access, or one of the company's Admins to make you an Admin.
- **Initiatives couldn't be loaded** — LFX Crowdfunding is unavailable right now. Select **Try again** after a moment.

## Related

- [View Initiatives](../view-initiatives/) — the initiatives you manage, in the Me lens
- [Manage Initiatives](../manage-initiatives/) — edit settings, change attribution, and archive or activate an initiative
- [Crowdfunding](../) — overview of the Crowdfunding section
