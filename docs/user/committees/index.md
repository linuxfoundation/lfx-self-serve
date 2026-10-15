---
title: Groups
description: View, create, and manage project committees (groups) in LFX Self Serve.
audience: [contributor, maintainer, board-member, executive-director]
product_area: Committees
tags: [committees, groups, governance, membership, management]
last_updated: 2026-10-11
intercom_collection: Committees
---

This page applies to users with **contributor**, **maintainer**, **board-member**, or **executive-director** personas. Contributors can view committee information but cannot create or manage committees.

In LFX Self Serve, committees are displayed as **Groups**. Navigate to **My Groups** at `/groups` to see your committee memberships. Committees are formal groups that govern project decisions, including Technical Steering Committees (TSCs), boards, and other working groups.

## My Groups

My Groups is your personal membership inventory across foundations and projects. Contributor, Maintainer, Board Member, and Executive Director personas use the same inventory; it does not grant new management or voting permissions.

- Use category buttons, search, and the **Voting capability** filter to narrow your groups. Search includes group names, descriptions, and categories and settles after a short delay.
- **Foundation** and **Project** filters appear when your persona and available membership scopes support them. Selecting or removing a Foundation clears Project; removing Project keeps Foundation selected. Project choices are constrained to the selected Foundation.
- Active filters appear as removable chips. Long labels wrap within the panel while their remove buttons remain available. Remove one to keep the others, or use **Clear all**. **Reset filters** in either view clears all filters when there are no matches. Summary totals remain based on all your memberships, not the filtered results.
- Choose **List** or **Cards**. Your view choice is restored after reload. List rows stack on narrow screens; Cards reveal additional groups through **Show more**. Result-count updates remain available to screen readers, including the final reveal when the partial count is no longer visible. Filters are not newly preserved when returning from group details.
- Group names are primary, with your role and owning-project context nearby when available. **Public**/**Private** describes visibility. Public groups offer a separate copy-link control.
- Voting **Enabled** or **Disabled** describes the group's capability, not your eligibility to vote or the presence of an active ballot. **Unavailable** means capability data is missing or unusable.
- Mailing-list and chat controls open only real destinations, including HTTP(S) URLs with uppercase or mixed-case schemes. Chat identifiers such as `#general` appear as informational text rather than links; long identifiers wrap within Cards. **Mailing list associated** without an address is also informational. **No channels** means no chat value, mailing-list address, or mailing-list association was returned.

If your inventory is empty, there is no filter panel or reset action; invitations and pending applications can still appear. Existing loading errors are not distinguished from an empty inventory on this page.

## What you can do

- View all committees for your project or foundation
- Create new committees
- Edit committee details and membership
- View committee members and their roles
- Manage committee settings

## Navigation

Go to **app.lfx.dev** and select **Groups** (route: `/groups`) from the left navigation. The committees dashboard lists all committees you have access to.

## Key concepts

- **Committee**: A formal group with defined membership and a governance role within a project
- **Committee view**: The detail page for a single committee, showing its members and settings
- **Committee management**: The create and edit workflow for committee configuration

## Related sections

- [Votes](../votes/) — create and manage polls for committee decisions
- [Meetings](../meetings/) — schedule and manage committee meetings
- [Documents](../documents/) — manage documents associated with committees
