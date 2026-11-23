---
title: Manage Participants
description: How to invite guests, add a group, resend invitations, remove people, and choose who runs a meeting in LFX Self Serve.
audience: [all]
product_area: Meetings
tags: [meetings, participants, guests, invite, registrants, groups, resend invite, add myself]
last_updated: 2026-11-19
intercom_collection: Meetings
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** personas, or anyone granted **Meeting Coordinator** access for the project. It explains how to control who is invited to a meeting. If you were invited to a meeting, see [Join a Meeting](../join-meeting/) instead.

The guest list matters beyond invitations. For a **Restricted** meeting, the guest list, together with the meeting's organizers, decides who can get past the registrant check on the join page.

## Open the guest list

You can manage guests in two places:

- **While creating or editing a meeting.** Open the **Invite guests** section of the meeting editor. When you create a meeting, nobody is invited until you save.
- **From a meeting card.** On an upcoming meeting you organize, **Invite people** opens the guest list with the **Add guest** form already open, and **Guests** or **View all** opens it for browsing. Changes you make here are saved straight away.

## Add guests

You can invite people one at a time, or invite a whole group.

### Add a person

1. In **Search and add guests**, start typing a name or email address.
2. Select the person from the results to add them to the **Invited** list.

If you can't find the person, select **Add manually** and fill in the guest's details: name and email, and optionally a job title and company. Select **Add guest** to add them.

If the person is already on the list, you'll see an **Already invited** message instead of a duplicate.

### Add yourself

Creating a meeting doesn't invite you to it. To get the invitation yourself, select **Add myself**. It's next to the **Invited** count in the meeting editor, and next to **Add Guest** in the guest list of a meeting card or the join page. In the editor you're invited when you save the meeting; in a meeting card's or the join page's guest list you're invited straight away.

You're added as a regular guest with your profile details: your name, job title and company. The invitation goes to your meeting-invitation email if you set one, otherwise to your primary email. If your meeting-invitation email setting can't be loaded, **Add myself** isn't offered, so the invitation never goes to the wrong address. If your profile is missing your first or last name, the editor opens the guest form with your details filled in so you can complete it. Guest lists outside the editor don't offer **Add myself** in that case, so use **Add Guest** instead.

- You're added as a guest, not a Meeting Host. To run the meeting, select **Make host** on your row.
- When you're editing a single occurrence of a recurring meeting, you're added to that occurrence only.
- In a meeting card's or the join page's guest list for a recurring meeting, you're added to every occurrence, unless you've opened **Add Guest** and chosen **Only** that date under **Invite to**.
- **Add myself** disappears once you're on the list, whether under your meeting-invitation, primary or sign-in email, or under another address listed with your LFID, as a group member's invitation is. For recurring meetings, this includes an invitation to just one occurrence. If you remove yourself, it comes back.

On the meetings list, an upcoming meeting you organize but aren't invited to also shows **Add Myself** on its card. Selecting it invites you straight away, to every occurrence of a recurring meeting, and the button changes to **Remove Myself**. While a self-invitation is being saved from either the card or the guest list, other self-add actions for that meeting wait for it to finish, even if you close the guest list. After it is saved, you can normally remove yourself straight away, and the card, guest list and attendance overview keep the confirmed guest state. If the card says your invitation is still syncing, it has been saved but its registration details aren't available yet. **Remove Myself** stays available to retry; if you see **Invitation syncing**, try it again shortly rather than adding yourself again. The card first checks the full guest list, so if you're already on it you're told so and nothing is sent twice. If another organizer has re-invited you since you removed yourself, the card includes that invitation in its guest count without losing the earlier removal adjustment. If the guest list can't be loaded, you see an error and you aren't added. If your profile is missing your first or last name, or your meeting-invitation email setting can't be loaded, the card opens the guest list on the **Add Guest** form so you can invite yourself there. If the meeting-invitation email setting is unavailable, you choose the address yourself; a manual invitation matching your signed-in email or LFID still updates your card and waits for any self-invitation already being saved. Removing that guest from the guest list updates the card too; if you have another invitation to the meeting, you remain invited.

### Add a group

You can link a group to the meeting to invite its members. Each member is still tracked as an individual guest.

1. In the groups panel, select the groups to link to the meeting. Members of the selected groups are added to the invitation list automatically.
2. If a selected group uses voting, a **Voting Status Selection** field lets you choose which voting statuses are allowed. Only members with the statuses you select are invited.
3. The panel shows how many groups are selected and how many unique members will be added.

Guests added through a group show a **via {group name}** label in the list, so you can tell them apart from people you added directly.

Wait for every selected group's members to load before saving invitation changes. If a group's members fail to load, the groups panel explains that they have not been added as guests and offers **Try again**. Saving stays disabled until loading succeeds; changing the group selection or voting-status filter waits for successful reconciliation too. An unchanged saved selection does not require opening **Invite guests** just to save an unrelated meeting edit.

If the roster reaches a safe loading limit, the panel explains that saving with an incomplete roster is blocked. Try again if the problem was temporary. If it persists, remove the group selection where it is editable to continue, or cancel and contact support. A group fixed by the meeting's creation context cannot be removed from that editor.

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

On a phone, each guest's row shows their status as text: **Accepted**, **Declined**, **Invite declined** (they declined the calendar invitation without replying to the RSVP), **Maybe**, or **Pending**. A guest with no name on file appears as **Guest**.

Use **Search people...** to filter a long list by name or email. In the guest list on the meeting card, the role filter shows only **Organizers**, or only **Hosts**, meaning guests marked as a Meeting Host who aren't organizers. Organizers are hosts already, so they appear under **Organizers** and not under **Hosts**.

## Resend an invitation

To send someone their invitation again:

1. Edit the meeting and open **Invite guests**.
2. Select the paper plane icon (**Resend invite**) next to the guest. On a phone, open the **⋮** menu on the guest's row and choose **Resend invite**.
3. Confirm in the **Resend invitation** dialog.

Resend is only available once the meeting is saved and the guest has been saved to it, so you won't see it for guests you've just added but haven't saved.

Guests can also resend their own invitation: it's the **Resend Invite** button on the meeting card and on the meeting's join page.

## Remove a guest

Select the **×** next to the guest to remove them from the list. On a phone, open the **⋮** menu on the guest's row and choose **Remove**.

- When you're creating a meeting, the guest is simply taken off the list. To invite them again, add them again.
- When you're editing a saved meeting, the removal takes effect when you save. Until then, an **Undo** notice appears above the list, so you can bring them back.

## Recurring meetings

For a recurring meeting, guests are invited to **All occurrences** by default.

- **From a meeting card or the join page**, the **Add guest** form asks whether to invite the guest to **All occurrences** (the default) or only the date shown.
- **When you edit a single occurrence**, the editor shows **Add guests to this occurrence**. Each guest is labelled **All occurrences** or **This occurrence**. You can remove only the guests labelled **This occurrence**. Guests invited to the whole series are read-only there, and the group settings and **Show attendees to guests** are not shown. To change them, edit the entire series.

## Let guests see who else is invited

**Show attendees to guests** lets guests see who else is invited, and who has accepted, on the meeting in LFX. Guests who can't see the list still see how many people are invited. Calendar invites never list other guests, whatever this setting says. **Board** meetings never share their guest list with guests, and the switch is locked for that type. On a **Restricted** (invited guests only) meeting you can turn the switch on in the **Invite guests** section like on any other meeting, and it stays on when you edit the meeting again.

## Related

- [Meetings overview](../) — an overview of the Meetings section
- [Schedule a Meeting](../schedule-meeting/) — create a new meeting
- [Manage Meetings](../manage-meetings/) — edit, cancel, or delete meetings
- [Host Controls and the Host Key](../host-controls/) — who runs the meeting and finds the host key
- [Join a Meeting](../join-meeting/) — RSVP, register, and leave a meeting as a guest
