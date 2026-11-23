---
title: Dashboard FAQ
description: Frequently asked questions about navigating the LFX Self Serve dashboard.
audience: [all]
product_area: Dashboards
tags: [dashboard, faq, lens, access, company, employer]
last_updated: 2026-11-05
intercom_collection: Dashboards
---

## Why don't I see all four lenses?

If you can use both Foundation and Projects, you see three tabs instead of four: Foundation and Projects share a single **Projects** tab in the sidebar. This is expected. Open **Projects** and select a foundation from the list to open the Foundation lens.

Otherwise, the lenses you see depend on your roles on Linux Foundation projects. Everyone sees **Me** and **Company**, and almost everyone sees **Projects**. **Foundation** is for board members, executive directors, foundation admins, Linux Foundation staff and a few other Linux Foundation admin, auditor and marketing roles. See [Who can see each lens](../#who-can-see-each-lens) for the full list. If you believe you should have access to a lens that is not listed in either place, contact your foundation or project administrator.

## Why can't I see my company's dashboard?

Everyone can open the **Company** lens, but your company's pages show only if your company has given you access. Access is granted by your company's own Company Lens administrators, not by the Linux Foundation. Ask them to grant you access. If you are not sure who they are, your company's open source program office (OSPO) is a good place to start.

Holding another role, such as committee member, board member or executive director, does not by itself give you access to your company's pages. See [Who can access this](../#who-can-access-this) for the messages you may see and what each one means. If you are a CLA Manager, see the [Company FAQ](../../company/faq/#why-can-t-i-see-my-company-in-the-company-lens).

## I added my company as an affiliation. Why can't I see my company?

Adding an affiliation links your profile to your employer, but it does not give you access to your company's pages in the **Company** lens. After you add it, you may see **You do not have access to the Company Lens** instead of **No company linked to your account**. Both mean the same thing: you have not been granted access yet.

Access comes only from your company's Company Lens administrators. Ask them to grant you access. If you are not sure who they are, your company's open source program office (OSPO) is a good place to start.

## Why does my dashboard show different content from a colleague's?

The dashboard adapts to your roles and the active project context. If you and your colleague have different roles or have selected different projects, your dashboards will look different.

## What does “Part of this page couldn't load” mean?

A page dependency could not load, for example after a release or a connection interruption.
For recognized download failures, Self Serve tries one automatic refresh within a
60-second window when browser storage is available. If recovery cannot proceed, or a
deferred component fails for an unknown reason, a persistent message offers **Reload
page** and **Contact support**.

Check your connection and save or copy any unsaved work before choosing **Reload
page**: refreshing can discard changes. The recovery message does not close your
current page or forms. It refreshes the current address, so retry your intended
navigation afterwards if necessary. If it still fails, choose **Contact support**.
If you cancel a browser confirmation to leave the page, the recovery actions become
available again after a short wait.
The message does not take keyboard focus from a field you are editing. If focus was
lost or on a menu control, it moves to the message rather than the reload button;
use Tab to reach **Reload page** and **Contact support**. An open mobile menu stays
open without trapping focus away from recovery.
If a drawer or dialog is open, the message and its actions appear inside the active
panel so you can reach them with Tab without closing it or losing your draft. When
you close that panel, the message remains available on the underlying page or panel.
Background preloading failures do not refresh the page while you are working.

## How do I change the project I'm viewing?

Use the project context picker in the top navigation when you are in the **Projects** or **Foundation** lens. Select a different project or foundation to update the entire page.

## My lens preference isn't being remembered. What should I do?

LFX Self Serve saves your lens selection in a browser cookie that lasts 30 days. If you are using private/incognito mode or your browser blocks cookies, the preference will not persist. Try using a standard browser session.

## What are the drawers I see when I click on dashboard cards?

Drawers are sliding side panels that show additional detail — such as metrics charts or related items — without navigating away from the dashboard. Close a drawer by selecting the close icon or pressing Escape.

## How do I get access to the Foundation lens?

The Foundation lens is available to board members and executive directors of a foundation, foundation admins, Linux Foundation staff, and a few other Linux Foundation admin, auditor and marketing roles. If you also have a project role, there is no separate Foundation tab: open the **Projects** tab and select a foundation. Contact your project administrator if you need elevated access.

## Why is the Health Metrics page not accessible to me?

The Health Metrics page (`/foundation/health-metrics`) is available only to the foundation's executive director and to Linux Foundation staff. Anyone else who opens it is taken to the Foundation overview instead.
