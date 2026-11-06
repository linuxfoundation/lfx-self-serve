---
title: Navigate Your Dashboard
description: How to switch lenses and use the LFX Self Serve dashboard effectively.
audience: [all]
product_area: Dashboards
tags: [dashboard, lens, navigation, organization, company, employer]
last_updated: 2026-11-05
intercom_collection: Dashboards
---

The LFX Self Serve dashboard adapts based on your roles and the lens you have selected. This article explains how to switch lenses, what each view contains, and how to use the project context switcher.

## Switch lenses

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Locate the lens switcher in the top navigation or sidebar.
3. Select one of the available lenses: **Me**, **Foundation**, **Projects**, or **Organization**. If you can use both Foundation and Projects, they appear as a single **Projects** tab that lists foundations and projects.
4. The dashboard and left navigation update automatically to reflect the selected lens.

On a phone or small screen, the lens switcher sits in the navigation menu. Selecting a lens there shows that lens's menu without leaving the page you are on: pick a page, project, foundation, or organization from it to switch, or close the menu to stay where you were.

Your lens selection is saved for 30 days. The next time you sign in, the app restores your last-used lens.

## Me lens

The **Me** lens (the default view at `/`) shows your personal activity across all your projects. You see your recent contributions, upcoming meetings, earned badges, and training enrollments.

If you manage groups, **My Pending Actions** also shows **Join request** rows across all the groups you can manage, with the applicant's email, optional name, and group. Select **View all** to review requests in the Pending Actions drawer. **Approve** asks you to confirm the applicant and group; **Reject** lets you add optional notes. A request disappears only after your decision is saved, and the drawer stays open while the list refreshes. After the final action is resolved, the drawer shows **All caught up!** and stays open until you close it. Users without managed groups or pending requests see no join-request rows.

Navigating to another page does not cancel a confirmed approval or rejection that is already being saved. If join-request discovery is too slow or unavailable, those rows are omitted for that refresh while the other pending-action sources remain available; a later refresh can load them again.

The drawer updates as the list refreshes, including loading RSVP controls for new meeting actions. If RSVP options fail to load, you can still open the meeting page; the card and drawer try loading those options again when a replacement feed arrives. Once the list is empty, the **My Pending Actions** section fades away after you close the drawer.

## Foundation lens

The **Foundation** lens (`/foundation/overview`) is available to board members, executive directors, LF Staff, and users with a writer role on the foundation (including root writers). It shows foundation-level health metrics, project summaries, and governance activity. Under **Metrics** in the left navigation, executive directors and LF Staff additionally see **Health Metrics** (`/foundation/health-metrics`) and [Social Listening](../../social-listening/) (`/foundation/social-listening`).

## Project lens

The **Projects** lens (`/project/overview`) focuses on a single project. Select the project you want to view from the project context picker. The view updates to show that project's committees, meetings, votes, and contributor metrics.

## Org lens

The **Organization** lens (also called the Org lens) shows your company's membership status and participation across Linux Foundation projects. "Organization" here means your company or employer, not a project group or committee. Everyone can open the lens, but your company's pages show only if your organization has granted you access. See [Who can access this](../#who-can-access-this). If you have access to more than one organization in the same corporate family, the lens can also show them together — see [What is an organization family roll-up?](../../organization/choose-an-organization/#what-is-an-organization-family-roll-up).

## Switch project context

When you are in the **Foundation** or **Projects** lens, you can switch between different projects or foundations using the context picker in the top navigation. Select a different foundation or project to update the entire page to that scope.

The picker can show a role label, such as **Contributor**, **Maintainer**, **Board Member**, or **Executive Director**, next to a project or foundation. The label reflects your detected involvement and can change which dashboard and cards you see, but it doesn't grant access. What you can create, edit, or manage on a project is set on the project's **Permissions** page. See [Permissions](../../permissions/).

## Drawers and detail panels

Many dashboard cards open a **drawer** (a side panel) when you select them. Drawers show detailed metrics, charts, or related items without leaving the current page. Close a drawer by selecting the close icon or pressing Escape.

## Related

- [Dashboard overview](../) — lenses and who can see each one
- [Committees](../../committees/) — manage your committees from the dashboard
- [Foundation Health Metrics](../foundation-health-metrics/) — health cards and the Health Metrics page
