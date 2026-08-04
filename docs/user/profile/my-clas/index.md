---
title: My CLAs
description: View your signed Individual and Employee CLAs in LFX Self Serve, and understand why an agreement might not appear.
audience: [all]
product_area: Profile
tags: [profile, cla, easycla, icla, ecla, identities]
last_generated: 2026-08-04
last_updated: 2026-08-04
intercom_collection: Profile
---

**My CLAs** is a read-only Profile tab that lists the Contributor License Agreements (CLAs) EasyCLA has on file for you. It answers: _which agreements have I signed, and under which projects am I covered?_

You do **not** sign a CLA from this page. Signing happens as part of the EasyCLA contributor flow when you contribute to a project that requires a CLA. The signing experience continues to evolve; this page only shows agreements already on file.

For broader EasyCLA concepts (what a CLA is, project and corporate consoles, troubleshooting), see the [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla).

## How to open My CLAs

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Profile** from the left navigation sidebar.
3. Open the **My CLAs** tab, or go directly to `/profile/clas`.

Agreements are matched automatically from your signed-in session and your [linked identities](/profile/identities) (Email, GitHub, GitLab). You never search or type a project name here.

## ICLA vs ECLA

| Type                      | What it means                                                                                                      | On My CLAs                                                               | Document                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **ICLA** (Individual CLA) | You signed as yourself for a project                                                                               | Listed                                                                   | **Download PDF** of your signed agreement                      |
| **ECLA** (Employee CLA)   | You are covered because your employer holds a Corporate CLA (CCLA) and you are on that company's **Approved List** | Listed (shows the employer name)                                         | No individual PDF — shown as _Covered by Corporate CLA (CCLA)_ |
| **CCLA** (Corporate CLA)  | Signed by a company CLA manager; covers employees via the company's **Approved List**                              | Not listed as its own row — it is the parent agreement an ECLA hangs off | Managed in the corporate EasyCLA flow, not on this tab         |

In short: an **ICLA** is _your_ paperwork; an **ECLA** means you are covered under your company's **CCLA**.

## What the list shows

When agreements are found, My CLAs shows a table with four columns:

| Column       | Contents                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| **Project**  | Project logo (or a placeholder), project name, and — when it differs — the CLA group name as secondary text |
| **Type**     | `ICLA`, or `ECLA · <company name>`                                                                          |
| **Signed**   | The date the agreement was signed                                                                           |
| **Document** | **Download PDF** for an ICLA; _Covered by Corporate CLA (CCLA)_ for an ECLA                                 |

Only currently valid agreements appear on this list.

### Empty state

If nothing matches your linked identities, you see:

- **No CLAs on file yet**
- _We haven't found any signed ICLAs or ECLAs for your linked identities._

That does not always mean you never signed — see the next section.

## Why a signed CLA might not show up

My CLAs only finds agreements that match an identity linked to your LFX account. A CLA can be missing from the list when:

- The **email**, **GitHub**, or **GitLab** account you used when signing is **not linked** to this LFX profile
- You signed under a **work or secondary email** that is not among your verified / linked emails
- You signed with a **GitHub or GitLab username** that is not connected under Identities

**What to do:** open [Identities](/profile/identities) (`/profile/identities`) and link the Email, GitHub, or GitLab accounts you use for contributions. Then return to **My CLAs** — matching is automatic once the identity is linked.

The info banner on the My CLAs tab also points to the same Identities flow: _Link your Email, GitHub, or GitLab accounts →_.

## Related

- [Profile overview](../) — Profile tabs and navigation
- [Edit your profile](../edit-profile/) — personal details, affiliations, and account settings
- [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla) — CLA concepts, consoles, and troubleshooting outside Self Serve
