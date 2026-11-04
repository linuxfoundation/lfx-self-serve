---
title: CLAs
description: View your signed Individual CLAs and your Corporate CLA coverage in LFX Self Serve, and download a signed ICLA.
audience: [all]
product_area: Account
tags: [account, cla, easycla, icla, ccla, identities]
last_updated: 2026-11-04
intercom_collection: Account
---

These steps apply to any signed-in user on LFX Self Serve.

**CLAs** is a tab under the Profile & Account hub that lists the Contributor License Agreements (CLAs) EasyCLA has on file for you. A CLA is the agreement that covers your contributions to a Linux Foundation project that requires one. The CLAs tab answers: _which agreements have I signed, and under which projects am I covered?_

The tab is read-only. You can download a signed Individual CLA, but you sign new agreements and manage Corporate CLA coverage in EasyCLA, not here. See [What Self Serve does not do](#what-self-serve-does-not-do).

For broader EasyCLA concepts (what a CLA is, project and corporate consoles, troubleshooting), see the [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla).

## Where do I find CLAs?

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select [**Profile & Account**](/profile) from the left navigation sidebar.
3. Open the **CLAs** tab, or go directly to `/profile/clas`.

Agreements are matched from your signed-in session and your linked [Email and GitHub identities](/profile/identities). You never search or type a project name to see your existing agreements.

## What is the difference between ICLA and CCLA?

An **ICLA** (Individual CLA) is _your_ paperwork, signed as yourself. A **CCLA** (Corporate CLA) is signed by a company CLA manager and covers its employees via the company's **Approved List** — if you're on that list, the CLAs tab shows your coverage under it as a row of its own. Both an ICLA and CCLA coverage can appear on the CLAs tab.

| Type                      | What it means                                                                             | On CLAs                                           | Document                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| **ICLA** (Individual CLA) | You signed as yourself for a project                                                      | Listed                                            | **Download PDF** when EasyCLA has the signed file; otherwise _PDF unavailable_ |
| **CCLA** (Corporate CLA)  | Your employer's agreement; you were approved under it via the company's **Approved List** | Your coverage is listed (shows the employer name) | _Covered by Corporate CLA (CCLA)_ — there is no individual PDF                 |

## What does the CLAs list show?

An info banner at the top of the tab reads: _Your signed ICLAs (Individual CLA) and CCLA coverage (Corporate CLA), matched to your Identities. Missing one? Link your Email or GitHub accounts →_. The link opens [Identities](/profile/identities).

When agreements are found, the CLAs tab shows a table with these columns:

| Column       | Contents                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| **Project**  | Project logo (or a placeholder), project name, and — when it differs — the CLA group name as secondary text |
| **Type**     | `ICLA`, `CCLA · <company name>`, or just `CCLA` when the employer name is not on record                     |
| **Signed**   | The date the agreement was signed                                                                           |
| **Document** | A **Download PDF** button, _Covered by Corporate CLA (CCLA)_, or _PDF unavailable_                          |

### Why does the CLAs tab say I have no CLAs?

If nothing matches your linked identities, you see:

- **No CLAs on file yet**
- _We haven't found any signed ICLAs or CCLA coverage for your linked identities._

The **Learn about CLAs** button opens this article. An empty list does not always mean you never signed — see [Why don't my signed CLAs show up?](#why-don-t-my-signed-clas-show-up).

### What if the list doesn't load?

If the tab can't reach EasyCLA, it shows **Couldn't load your CLAs** — _Something went wrong loading your agreements. Please try again._ Select **Retry** to load the list again.

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

## Can I download my signed CLA PDF?

Yes for an **ICLA**, when EasyCLA has the signed file — select **Download PDF** in the row's **Document** column. When EasyCLA does not have the file, the column shows _PDF unavailable_.

No for CCLA coverage. It's under your company's Corporate CLA (CCLA), so there is no individual PDF to download, and the column shows _Covered by Corporate CLA (CCLA)_.

## What Self Serve does not do

The CLAs tab shows your agreements. It never:

- **Signs a new CLA.** Agreements are presented and signed in EasyCLA — see the [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla).
- **Approves, invalidates, or revokes an agreement.** Those changes are made by a CLA manager in the Corporate CLA Console, by a project maintainer, or by EasyCLA's own screening.
- **Edits your employer's Approved List.** Ask your employer's CLA manager to add or remove you.

## Related

- [Account overview](../) — all account areas and navigation
- [Account FAQ](../faq/) — short answers to common account questions, including CLAs
- [Identities](../identities/) — link the Email and GitHub accounts your CLAs are matched against
- [Edit your profile](../../profile/edit-profile/) — name, photo, About Me, primary email, and location
- [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla) — CLA concepts, consoles, and troubleshooting outside Self Serve
