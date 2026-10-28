---
title: Manage Participants
description: How to invite guests, add a group, resend invitations, remove people, and choose who runs a meeting in LFX Self Serve.
audience: [all]
product_area: Meetings
tags: [meetings, participants, guests, invite, registrants, groups, resend invite]
last_updated: 2026-10-28
intercom_collection: Meetings
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** personas, or anyone granted **Meeting Coordinator** access for the project. It explains how to control who is invited to a meeting. If you were invited to a meeting, see [Join a Meeting](../join-meeting/) instead.

The guest list matters beyond invitations. For a **Restricted** meeting, the guest list, together with the meeting's organizers, decides who can get past the registrant check on the join page.

## Open the guest list

You can manage guests in two places:

- **While creating or editing a meeting.** Open the **Invite guests** section of the meeting editor. When you create a meeting, nobody is invited until you save.
- **From a meeting card.** On an upcoming meeting you organize, **Invite people** opens the guest list with the **Add guest** form already open, and **View all** opens it for browsing.

## Add guests

You can invite people one at a time, or invite a whole group.

### Add a person

1. In **Search and add guests**, start typing a name or email address.
2. Select the person from the results to add them to the **Invited** list.

If you can't find the person, select **Add manually** and fill in the guest's details: name and email, and optionally a job title and organization. Select **Add guest** to add them.

If the person is already on the list, you'll see an **Already invited** message instead of a duplicate.

### Add a group

You can link a group to the meeting to invite its members. Each member is still tracked as an individual guest.

1. In the groups panel, select the groups to link to the meeting. Members of the selected groups are added to the invitation list automatically.
2. If a selected group uses voting, a **Voting Status Selection** field lets you choose which voting statuses are allowed. Only members with the statuses you select are invited.
3. The panel shows how many groups are selected and how many unique members will be added.

Guests added through a group show a **via {group name}** label in the list, so you can tell them apart from people you added directly.

#### What happens when someone leaves a group

For a public meeting, **Registration on group removal** controls what happens to a guest's registration when they're removed from a linked group:

- **Use project default** — follow the project's setting.
- **Cancel registration** — removing someone from the group also cancels their registration on this meeting.
- **Keep registration** — they stay invited to the meeting even after leaving the group.

## Choose who runs the meeting

To let a guest run the meeting, mark them as a **Meeting Host** in the **Add guest** form, or select **Make host** on their row later. Select **Remove host** to take it away. They show a **Host** label in the list. A Meeting Host can see the host key on the meeting's join page, but can't edit the meeting. See [Host Controls and the Host Key](../host-controls/).

Marking a guest as a host is separate from being an organizer. Only organizers can edit, cancel, or delete a meeting, and change who is invited.

## Review the invited list

The **Invited** card shows how many people are invited. When the meeting collects RSVPs, it also shows how many have accepted, for example "6 of 10 accepted". Hover over that line (or focus it with the keyboard) to see the full breakdown of accepted, declined, and awaiting a reply.

Use **Search people...** to filter a long list by name or email. In the guest list on the meeting card, the role filter shows only **Organizers**, or only **Hosts**, meaning guests marked as a Meeting Host who aren't organizers. Organizers are hosts already, so they appear under **Organizers** and not under **Hosts**.

## Resend an invitation

To send someone their invitation again:

1. Edit the meeting and open **Invite guests**.
2. Select the paper plane icon (**Resend invite**) next to the guest.
3. Confirm in the **Resend invitation** dialog.

Resend is only available once the meeting is saved and the guest has been saved to it, so you won't see it for guests you've just added but haven't saved.

Guests can also resend their own invitation: it's the **Resend Invite** button on the meeting card and on the meeting's join page.

## Remove a guest

Select the **×** next to the guest to remove them from the list.

- When you're creating a meeting, the guest is simply taken off the list. To invite them again, add them again.
- When you're editing a saved meeting, the removal takes effect when you save. Until then, an **Undo** notice appears above the list, so you can bring them back.

## Recurring meetings

For a recurring meeting, guests are invited to **All occurrences** by default.

- **From a meeting card or the join page**, the **Add guest** form asks whether to invite the guest to **All occurrences** (the default) or only the date shown.
- **When you edit a single occurrence**, the editor shows **Add guests to this occurrence**. Each guest is labelled **All occurrences** or **This occurrence**. You can remove only the guests labelled **This occurrence**. Guests invited to the whole series are read-only there, and the group settings and **Show attendees to guests** are not shown. To change them, edit the entire series.

## Let guests see who else is invited

**Show attendees to guests** lets guests see who else is invited, and who has accepted, on the meeting in LFX. Guests who can't see the list still see how many people are invited. Calendar invites never list other guests, whatever this setting says. Board and Restricted meetings never share their guest list with guests, and the switch is locked for the Board type.

## Related

- [Meetings overview](../) — an overview of the Meetings section
- [Schedule a Meeting](../schedule-meeting/) — create a new meeting
- [Manage Meetings](../manage-meetings/) — edit, cancel, or delete meetings
- [Host Controls and the Host Key](../host-controls/) — who runs the meeting and finds the host key
- [Join a Meeting](../join-meeting/) — RSVP, register, and leave a meeting as a guest
