---
title: Meeting Materials
description: How to add, organize, and find files and links for a meeting in LFX Self Serve.
audience: [all]
product_area: Meetings
tags: [meetings, materials, files, links, documents, attachments, agenda]
last_updated: 2026-10-28
intercom_collection: Meetings
---

Meeting materials are the files and links attached to a meeting, such as slides, a design doc, or a repository. Organizers add them so attendees can prepare, and so there is a record of what was shared. Files appear as **Primary Materials** and links as **Supporting Materials**.

Only people who can open the meeting can see its materials. See [Who can see materials](#who-can-see-materials).

## Add materials while you create or edit a meeting

Organizers need a **maintainer**, **board-member**, or **executive-director** persona, or **Meeting Coordinator** access for the project.

1. Open the meeting editor with **Create Meeting**, or **Edit** on a meeting card.
2. Go to the **Agenda & resources** section.
3. Under **Documents**, select **Click to upload files or drag and drop**, or drop files onto the area. Each file you pick is listed with its size, and you can remove it with the **×** before you save.
4. Under **Links**, select **Add link**. Enter a **Title** and a full URL that starts with `https://`, then select **Add link**.
5. Save the meeting.

When you edit only one occurrence of a recurring meeting, this section doesn't include documents or links. To change them, edit the entire series, or use **Manage materials** below.

## Manage materials on an existing meeting

You can change a meeting's materials from where you see them, without opening the editor. Select:

- **Edit materials** on the meeting's card in the Meetings list
- **Manage** on the **Meeting Materials** panel of the meeting's join page
- **Manage** on the **Resources** panel of a past meeting's details page

Each opens the **Manage Materials** panel, with these parts:

- **Applies to** (recurring meetings only): whether the files and links you add apply to one occurrence or the whole series. See [Recurring meetings](#recurring-meetings).
- **Upload Files**: lists **New Files** you've picked and **Existing Files** already on the meeting.
- **Add Links**: enter a **Link title** and a URL, then add it. Existing links are listed under **Existing Links**.

### What saves when

- **Links** are added as soon as you add them. You'll see a "Link Added" message.
- **Files**, **removals**, and **scope changes** wait for you. Files you've picked show under **New Files**, and anything you change on an existing item shows as **Unsaved**. Select **Save Changes** to apply everything, or **Cancel** to throw the changes away.
- To remove an existing file or link, mark it for removal. Until you save, you can undo it.

### File limits

- Each file can be up to **100 MB**.
- Supported types are PDF, Word, Excel, and PowerPoint documents, images (JPEG, PNG, GIF, WebP, and SVG), and text files (plain text, Markdown, CSV, and RTF).
- You can't pick the same file name twice in one session, and a file name can't start with a dot or contain `..`.

If a file isn't accepted, you'll see a **File Upload Error** that says why.

## Add materials to a single occurrence

For a recurring meeting, you can add materials to just one date, for example slides that only apply to that session.

1. Open the occurrence you want, either from its card in the Meetings list or from the meeting's join page (use the occurrence navigation to pick the date).
2. Select **Edit materials** on the card, or **Manage** on the **Meeting Materials** panel.
3. Under **Applies to**, choose **This occurrence**. The panel shows the date it will apply to.
4. Upload files or add links, then select **Save Changes**.

The materials appear only on that date's card and page. The meeting editor can't do this: when you edit a single occurrence there, documents and links aren't included. Use **Edit materials** or **Manage** instead.

## Recurring meetings

On a recurring meeting, materials apply to **one occurrence** or to **all occurrences**:

- Under **Applies to**, choose **This occurrence** or **All occurrences** (every date in the series) before you add files or links. New materials default to all occurrences.
- Each existing item shows a **This occurrence** or **All occurrences** label. Use **Limit to this occurrence** or **Apply to all occurrences** to change it, then **Save Changes**.
- Materials for one occurrence appear only on that date's card and page, and only registrants of that date are notified of them. Materials for all occurrences appear on every date.
- You can limit materials only to an upcoming occurrence that hasn't been cancelled. If an occurrence is rescheduled, its materials move with it.

## Find a meeting's materials

- **On the meeting card.** The **Materials** area lists the files and links, with a count. On a recurring meeting, they are grouped under **This occurrence** and **All occurrences**.
- **On the join page.** The **Meeting Materials** panel lists **Primary Materials** (files you can download) and **Supporting Materials** (links). An **Updated** tag appears when something was added or changed in the last 7 days.
- **On a past meeting.** The **Resources** panel on the meeting's details page lists its files and links. Organizers always see this panel, so they can add to it. Everyone else sees it only when it has something in it.

## After the meeting runs

When a meeting runs and becomes a past meeting, its materials are put onto the past meeting. From then on, a past meeting's materials are managed separately from the upcoming meeting's. You can add, remove, or change them on the past meeting's **Resources** panel, using **Manage**, without affecting the upcoming meeting.

## Who can see materials

You need to be **signed in** to see materials, and you need access to the meeting itself. Being signed in alone isn't enough for a private meeting.

For an upcoming meeting:

- **Public meeting with no join restriction:** anyone who is signed in can see its materials.
- **Private or Restricted meeting:** only people invited to the meeting, including people added through a linked group, and organizers can see its materials.
- **Someone who joins a private meeting with only its password link** sees the title and what they need to join. They don't see the agenda, materials, or the date and time, even if they're signed in.

For a past meeting:

- **Public meeting with no join restriction:** anyone who is signed in.
- **Otherwise:** organizers, people who were invited, people who actually attended, and members of a group linked to the meeting.

Only organizers can add, change, or remove materials.

## Related

- [Meetings overview](../) — an overview of the Meetings section
- [Schedule a Meeting](../schedule-meeting/) — create a meeting and its agenda
- [Manage Meetings](../manage-meetings/) — edit, cancel, or delete meetings
- [Join a Meeting](../join-meeting/) — how attendees see materials on the join page
