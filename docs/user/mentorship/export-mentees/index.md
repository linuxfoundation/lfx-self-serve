---
title: Export Mentees
description: How a Program Admin downloads an LFX Mentorship program's mentees as a CSV.
audience: [all]
product_area: Mentorship
tags: [mentorship, program-admin, export, csv, download, mentees]
last_generated: 2026-10-26
last_updated: 2026-10-26
intercom_collection: Mentorship
---

These steps apply to Program Admins.

**Download by Status** produces a CSV (comma-separated values) file of one tab's applications — open terms on **Current Mentees**, closed terms on **Past Mentees** — for one status or for all of them.

## Before you begin

You must be a Program Admin on the program.

## Steps

1. Open the program from [app.lfx.dev/mentorship/admin](https://app.lfx.dev/mentorship/admin).
2. Go to **Current Mentees** or **Past Mentees**.
3. Open **Download by Status**.
4. Pick a status, or **All**.

## What the file contains

One row per application, with these columns in this order:

| Column          |
| --------------- |
| Name            |
| Email           |
| Status          |
| Term            |
| Tasks Submitted |
| Applied On      |
| Updated On      |

The file is named after the tab and the status you picked — for example `current-mentees-accepted.csv` or `past-mentees-all.csv`.

The file contains personal data. Handle and share it accordingly.

**Filtering or searching the table does not narrow the export.** The download takes only the tab you are on and the status you pick in the download menu — a term filter or a search term you typed into the table is not sent. If a download comes back incomplete, narrow it by export status; there is no way to export a single term.

## Troubleshooting

| What you see                                       | What it means                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| "Nothing to download"                              | No mentees on this tab have that status.                                                                                                     |
| "Download incomplete"                              | The program has more mentees than one download can include; the file holds only the first batch. Narrow by export status and download again. |
| "You don't have access to this program's mentees." | You are no longer a Program Admin on it.                                                                                                     |
| "The download failed. Please try again."           | A transient failure.                                                                                                                         |

## Related

- [Review Applications and Decide](../review-applications/)
- [Your Programs (Program Admin)](../admin-programs/)
