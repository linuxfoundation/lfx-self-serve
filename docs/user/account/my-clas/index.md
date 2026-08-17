---
title: CLAs
description: View your signed Individual and Employee CLAs in LFX Self Serve, and understand why an agreement might not appear.
audience: [all]
product_area: Account
tags: [account, cla, easycla, icla, ecla, identities]
last_generated: 2026-08-04
last_updated: 2026-08-11
intercom_collection: Account
---

These steps apply to any signed-in user on LFX Self Serve.

**CLAs** is a read-only tab under the Profile & Account hub that lists the Contributor License Agreements (CLAs) EasyCLA has on file for you. A CLA is the agreement that covers your contributions to a Linux Foundation project that requires one. The CLAs tab answers: _which agreements have I signed, and under which projects am I covered?_

You cannot sign a CLA from this page. Signing happens outside the CLAs tab, and the signing process may evolve; this page only shows agreements already on file.

For broader EasyCLA concepts (what a CLA is, project and corporate consoles, troubleshooting), see the [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla).

## Where do I find CLAs?

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select [**Profile & Account**](/profile) from the left navigation sidebar.
3. Open the **CLAs** tab, or go directly to `/profile/clas`.

Agreements are matched from your signed-in session and your linked [Email and GitHub identities](/profile/identities). You never search or type a project name here.

## What is the difference between ICLA and ECLA?

| Type                      | What it means                                                                                                      | On CLAs                                                                  | Document                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **ICLA** (Individual CLA) | You signed as yourself for a project                                                                               | Listed                                                                   | **Download PDF** when EasyCLA has the signed file (otherwise _PDF unavailable_) |
| **ECLA** (Employee CLA)   | You are covered because your employer holds a Corporate CLA (CCLA) and you are on that company's **Approved List** | Listed (shows the employer name)                                         | No individual PDF — shown as _Covered by Corporate CLA (CCLA)_                  |
| **CCLA** (Corporate CLA)  | Signed by a company CLA manager; covers employees via the company's **Approved List**                              | Not listed as its own row — it is the parent agreement an ECLA hangs off | Managed in the corporate EasyCLA flow, not on this tab                          |

In short: an **ICLA** is _your_ paperwork; an **ECLA** means you are covered under your company's **CCLA**.

## What does the CLAs list show?

When agreements are found, the CLAs tab shows a table with four columns:

| Column       | Contents                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Project**  | Project logo (or a placeholder), project name, and — when it differs — the CLA group name as secondary text         |
| **Type**     | `ICLA`, or `ECLA · <company name>`                                                                                  |
| **Signed**   | The date the agreement was signed                                                                                   |
| **Document** | **Download PDF** for an ICLA when available (else _PDF unavailable_); _Covered by Corporate CLA (CCLA)_ for an ECLA |

Only currently valid agreements appear on this list.

### Why does the CLAs tab say I have no CLAs?

If nothing matches your linked identities, you see:

- **No CLAs on file yet**
- _We haven't found any signed ICLAs or ECLAs for your linked identities._

That does not always mean you never signed — see the next section.

## Why don't my signed CLAs show up?

The CLAs tab only finds agreements that match an identity linked to your LFX account. Matching today uses your LF username, verified emails, and linked GitHub accounts. A CLA can be missing from the list when:

- The **email** or **GitHub** account you used when signing is **not linked** to this LFX profile
- You signed under a **work or secondary email** that is not among your verified / linked emails
- You signed with a **GitHub username** that is not connected under Identities

**What to do:**

1. Open [Identities](/profile/identities).
2. Link the Email or GitHub accounts you used when signing.
3. Return to **CLAs** — newly linked Email/GitHub identities are included on the next load.

If an agreement is still missing after that, see [EasyCLA troubleshooting](https://docs.linuxfoundation.org/lfx/easycla/v2-current/getting-started/easycla-troubleshooting).

The info banner on the CLAs tab also points to the Identities flow (_Link your Email or GitHub accounts →_). Linking Email or GitHub is what recovers missing CLA matches today.

## Can I download my signed CLA PDF?

Yes for an **ICLA**, when EasyCLA has the signed file — use **Download PDF** in the Document column. If the file is missing, the row shows _PDF unavailable_.

No for an **ECLA**. Employee coverage is under your company's Corporate CLA (CCLA), so there is no individual PDF to download. The Document column shows _Covered by Corporate CLA (CCLA)_.

## Can I sign a CLA from the CLAs tab?

No. The CLAs tab is read-only. Signing happens outside this tab, and the process may evolve. See the [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla) for current guidance.

## Related

- [Account overview](../) — all account areas and navigation
- [Account FAQ](../faq/) — short answers to common account questions, including CLAs
- [Edit your profile](../../profile/edit-profile/) — name, photo, About Me, primary email, and location
- [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla) — CLA concepts, consoles, and troubleshooting outside Self Serve
