---
title: Manage Documents
description: How to browse, upload, and organize project documents in LFX Self Serve.
audience: [maintainer, board-member, executive-director]
product_area: Documents
tags: [documents, manage, browse, upload, folders, links]
last_updated: 2026-10-28
intercom_collection: Documents
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** personas. Use the Documents section to find and work with files associated with your project or foundation.

## Browse documents

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Use the lens switcher to choose a project or foundation.
3. Select **Documents** from the left navigation sidebar.
4. The documents dashboard lists documents from all sources associated with that project or foundation: direct project files and links, committee documents, meeting attachments and recordings, and mailing-list artifacts.

Folders appear first in alphabetical order. Documents appear from most recent to oldest by the date shown, both at the root and inside folders. Search and the source tabs keep this ordering. Documents without a valid date appear last.

## Filter and search documents

Use the tabs above the list to filter by source:

- **All** — every document
- **Project** — files and links uploaded directly to the project
- **Groups** — documents from project committees (groups)
- **Meetings** — meeting attachments, recordings, transcripts, and summaries
- **Mailing Lists** — artifacts from the project's mailing lists

Each tab shows how many documents it would list for your current search. Tabs with no matches show no count. Use the search box to find documents by name, or by the group or meeting they belong to. Meeting attachments are matched by file name only, so search for the file name rather than the meeting title. From the top level, search looks inside every folder, so you can find a document without knowing where it is stored. Inside a folder, search narrows that folder's contents.

## Where documents come from

The Documents page gathers documents from several parts of LFX in one list. It only lets you add to and organize the project's own documents. Everything else is managed where it comes from, and shows up here automatically.

| Tab                                               | Where it comes from                                           | How to manage it                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project**                                       | Files, folders, and links added directly to the project       | Here, on the project or foundation Documents page, with **Upload Files**, **New Folder**, and **Add Link**. You need write access.                                                                             |
| **Groups**                                        | Files and links added to a group (committee)                  | On the group's own page. Open **Groups** in the left navigation, select the group, and open its **Documents** tab. See [Group documents](#group-documents) below.                                              |
| **Meetings** (attachments)                        | Files and links attached to an upcoming or past meeting       | In the Meetings section, on the meeting itself. See [Meeting Materials](../../meetings/meeting-materials/). A past meeting's materials are managed separately from the upcoming meeting's.                     |
| **Meetings** (recordings, transcripts, summaries) | Created after a meeting runs, if the organizer turned them on | They aren't added or edited here. Find them on the meeting's [Past Meetings](../../meetings/past-meetings/) page. The organizer's **Who can access recordings & summaries** setting controls who can see them. |
| **Mailing Lists**                                 | Files and links shared through the project's mailing lists    | They aren't added or edited in LFX. They come from the mailing list itself. See [Mailing Lists](../../mailing-lists/).                                                                                         |

Because of this, the **Upload Files**, **New Folder**, and **Add Link** buttons on this page only ever add to the **Project** source, whichever tab you have selected. To add a document to a group, a meeting, or a mailing list, go to that group, meeting, or mailing list.

### Group documents

Every group has its own **Documents** tab on its details page. Anyone who can view the group can see the tab, and its badge shows how many documents it holds. If you have write access to the group, you also get **Upload Files**, **New Folder**, and **Add Link** there, and they work the same way as on the project Documents page. See [Manage Committees](../../committees/manage-committees/).

Documents you add to a group also appear on the project Documents page, in the **Groups** tab, with the group's name in the **Group / Meeting** column. Folders you create in a group stay on that group's page. The project page lists the group's files and links on their own, without the folders.

### Folders

Folders are available for two kinds of documents:

- **Project documents**, on the project or foundation Documents page.
- **Group documents**, on each group's **Documents** tab.

Meeting materials, recordings, transcripts, summaries, and mailing-list files can't be put in folders. They always appear at the top level of the list.

## Open folders

Select a folder name to open it. A breadcrumb appears above the list; select **Documents** in the breadcrumb to return to the top level. If you are searching inside a folder, clear the search first to show the breadcrumb.

## Open a document

Each row has an action icon on the right. Hover over it to see what it does:

- **Download** — downloads an uploaded file
- **Open link** — opens a link in a new tab
- **Play recording** — opens a meeting recording
- **Open** — opens a meeting transcript
- **Preview** — shows a meeting summary. The icon is disabled when the summary isn't available.

You can also select a document's name to open, download, or preview it.

## Upload files, create folders, and add links

The **Upload Files**, **New Folder**, and **Add Link** buttons appear above the list only if you have write access to the active project or foundation. If you don't see them, ask a project administrator for access.

### Upload files

1. Select **Upload Files**.
2. Drag files into the upload area, or click it to choose files.
3. Optionally edit the name of each file to change how it is displayed, or remove a file you added by mistake.
4. Optionally choose a **Folder** to put the files in. Leave it as **No folder** to add them at the top level. The **Folder** field appears once the project has at least one folder.
5. Optionally add a **Description**.
6. Confirm the upload.

### Add a link

1. Select **Add Link**.
2. Enter the **Link URL** and a **Title**. Both are required.
3. Optionally choose a **Folder** and add a **Description**.
4. Confirm.

### Create a folder

1. Select **New Folder**.
2. Enter a **Folder Name**. This is required. Folders don't have a description.
3. Confirm.

If you open a folder first, the upload and link forms start with that folder selected.

## Switch project context

Documents are scoped to a specific project or foundation. Use the lens switcher in the top navigation to change your active project or foundation. The documents list updates automatically.

## Related

- [Documents overview](../) — an overview of the Documents section
- [Meetings](../../meetings/) — meeting agendas are often stored as documents
