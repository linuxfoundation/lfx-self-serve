---
title: CLAs
description: View your signed Individual and Employee CLAs in LFX Self Serve, start signing a new one, and ask a CLA manager to approve or remove your Employee CLA.
audience: [all]
product_area: Account
tags: [account, cla, easycla, icla, ecla, ccla, identities, signing]
last_updated: 2026-09-01
intercom_collection: Account
---

These steps apply to any signed-in user on LFX Self Serve.

**CLAs** is a tab under the Profile & Account hub that lists the Contributor License Agreements (CLAs) EasyCLA has on file for you. A CLA is the agreement that covers your contributions to a Linux Foundation project that requires one. The CLAs tab answers: _which agreements have I signed, under which projects am I covered, and does any of them need attention?_

From this tab you can also start signing a new CLA, and ask your employer's CLA managers to approve or remove an Employee CLA. Neither is completed here, but the two end differently: signing hands you off to the EasyCLA Contributor Console, while a manager request is submitted from this tab and a CLA manager then acts on it in the Corporate CLA Console. See [What Self Serve does not do](#what-self-serve-does-not-do).

For broader EasyCLA concepts (what a CLA is, project and corporate consoles, troubleshooting), see the [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla).

## Where do I find CLAs?

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select [**Profile & Account**](/profile) from the left navigation sidebar.
3. Open the **CLAs** tab, or go directly to `/profile/clas`.

Agreements are matched from your signed-in session and your linked [Email and GitHub identities](/profile/identities). You never search or type a project name to see your existing agreements.

## What is the difference between ICLA and ECLA?

An **ICLA** (Individual CLA) is _your_ paperwork, signed as yourself. An **ECLA** (Employee CLA) is coverage that came from your employer's **CCLA** (Corporate CLA) rather than from an agreement of your own. Both appear on the CLAs tab, and the **Status** column says whether each one still applies.

| Type                      | What it means                                                                                                  | On CLAs                                                                  | Document                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **ICLA** (Individual CLA) | You signed as yourself for a project                                                                           | Listed                                                                   | **Download PDF** when EasyCLA has the signed file and the ICLA is not **Invalidated**; otherwise the row offers no download |
| **ECLA** (Employee CLA)   | Your employer holds a Corporate CLA (CCLA) and you were approved under it via that company's **Approved List** | Listed (shows the employer name), and stays listed if the coverage ends  | No individual PDF — where the row has a **⋮** menu, it shows _Covered by Corporate CLA (CCLA)_                              |
| **CCLA** (Corporate CLA)  | Signed by a company CLA manager; covers employees via the company's **Approved List**                          | Not listed as its own row — it is the parent agreement an ECLA hangs off | Managed in the corporate EasyCLA flow, not on this tab                                                                      |

## What does the CLAs list show?

When agreements are found, the CLAs tab shows a table with these columns:

| Column      | Contents                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project** | Project logo (or a placeholder), project name, and — when it differs — the CLA group name as secondary text                                              |
| **Type**    | `ICLA`, `ECLA · <company name>`, or just `ECLA` when the employer name is not on record                                                                  |
| **Status**  | Whether the agreement is in force — see [What do the status labels mean?](#what-do-the-status-labels-mean)                                               |
| **Signed**  | The date the agreement was signed, and — when EasyCLA recorded it — the account it was signed under                                                      |
| ⋮ (actions) | The actions available for that row, such as **Download PDF** or **Request Removal** — see [What can I do from a CLA row?](#what-can-i-do-from-a-cla-row) |

Agreements that are no longer in force stay on the list with a status that says so, rather than disappearing. That is deliberate: seeing that an agreement was invalidated is more useful than seeing nothing.

### Why does the CLAs tab say I have no CLAs?

If nothing matches your linked identities, you see:

- **No CLAs on file yet**
- _We haven't found any signed ICLAs or ECLAs for your linked identities._

That does not always mean you never signed — see [Why don't my signed CLAs show up?](#why-don-t-my-signed-clas-show-up).

## What do the status labels mean?

The **Status** column on the CLAs tab tells you whether an agreement still covers your contributions. These are the labels it uses:

| Status              | What it means                                                                                                                                                                    | Applies to |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Valid**           | The agreement is in force and covers your contributions. Nothing to do.                                                                                                          | ICLA, ECLA |
| **Needs attention** | You were approved once, but the agreement no longer covers you — most often because you have dropped off your employer's **Approved List**.                                      | ECLA only  |
| **Invalidated**     | The agreement is no longer in force. A CLA manager removed you from your employer's **Approved List**, a project maintainer invalidated your ICLA, or the CLA group was deleted. | ICLA, ECLA |
| **Revoked**         | Your employer was flagged by sanctions screening. This is set by EasyCLA, cannot be changed from Self Serve, and leaves no actions on the row.                                   | ECLA only  |

When an ECLA needs attention because you are no longer on the Approved List, the row adds a line under the status: _No longer matches \<company\>'s approval criteria._

**Invalidated and Revoked are not the same thing**, and the tab keeps them visibly apart on purpose. **Revoked** is only ever a sanctions-screening outcome. Being removed from an Approved List — including at your own request — or having a maintainer invalidate your ICLA shows as **Invalidated**, so that an ordinary administrative change is never presented as a screening result.

## Which identity was a CLA signed under?

When EasyCLA recorded the account used to sign, the **Signed** cell adds a second line under the date:

- _Signed as \<username\> (GitHub)_
- _Signed as \<username\> (GitLab)_
- _Signed as \<username\> (Gerrit)_ — also used for agreements identified by LF login or email address, which have no separate platform of their own
- _Signed as \<identity\>_ — with no platform label, when EasyCLA recorded an identity but no recognised platform for it

This line is informational. It records the account used at signing time, which is useful when you sign from more than one account and are working out why a project still asks you to sign. It is historical: EasyCLA reports whatever it recorded when the agreement was signed, so the account named does not have to be an identity currently linked to your profile.

The line is omitted when EasyCLA has no signing identity on record for that agreement. That applies equally to ICLAs and ECLAs — a missing line means missing data, not a difference between the two types.

## What can I do from a CLA row?

Each row ends with a **⋮** menu listing only the actions available for that agreement. A row with no available actions shows no **⋮** at all.

| Action                     | When it appears                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Download PDF**           | On an ICLA that is not **Invalidated**, when EasyCLA has the signed file                                                                   |
| **Download PDF** (greyed)  | On an ECLA that is not **Revoked**, annotated _Covered by Corporate CLA (CCLA)_ — employee coverage has no individual document to download |
| **Request approval**       | On an ECLA that is no longer on your employer's **Approved List**                                                                          |
| **Request Removal**        | On any ECLA that is not **Revoked**                                                                                                        |
| **Contact CLA Manager**    | On a **Valid** or **Needs attention** ECLA                                                                                                 |
| **Manage in CCLA Console** | On an ECLA where EasyCLA records you as a CLA manager for that company's Corporate CLA                                                     |

You will not see a **⋮** on:

- Any **Revoked** row — these are read-only
- An **Invalidated** ICLA
- An ICLA whose signed file EasyCLA does not have

## How do I sign a new CLA?

You start signing from the CLAs tab and finish in the EasyCLA Contributor Console:

1. Select **Sign CLA** at the top right of the CLAs tab.
2. In the **Sign a CLA** dialog, type at least three characters. You can search by project name, CLA group name, a linked GitHub, GitLab, or Gerrit organization, or by pasting a repository link.
3. Each result shows why it matched — project name, CLA group name, linked organization, or repository link — so you can tell near-identical names apart.
4. Select the right result and choose **Continue to sign**.
5. Choose which of your linked GitHub accounts to sign under, then select **Continue to sign** again. Nothing is selected for you, and the step appears even when you have only one account linked — its job is to tell you which identity the agreement will be recorded against. If you have no GitHub account linked, the step says so and offers a link to [Identities](/profile/identities); you cannot continue past it until you link one.
6. Self Serve hands you off to the EasyCLA Contributor Console, which presents and records the agreement. When you finish there, you are returned to the CLAs tab.

If the search returns more matches than it can display, narrow the term — the dialog tells you when results were truncated.

### Why does a search result say "Already signed as"?

In the **Sign a CLA** dialog, a result you already hold a CLA for is tagged **Already signed as** followed by the account it was signed under. Hover the result to see which agreement you hold — an ICLA (Individual CLA) or an ECLA (Employee CLA).

The result stays selectable, because holding a CLA under one identity does not stop you signing under another. If you have two GitHub accounts linked to your profile and signed with one of them, you can still sign with the other. Continue past the result and the identity step shows you which of your identities is already covered: it is greyed out, and the rest stay available.

Results are matched per **CLA group**, not per project. A project with more than one CLA group only tags the group you signed.

Which statuses grey out an identity in the next step:

| Status on your existing CLA | Identity greyed out? | What to do instead                                                                                                                        |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Valid**                   | Yes                  | Nothing — that identity is already covered                                                                                                |
| **Needs attention** (ECLA)  | Yes                  | Signing again does not restore coverage. Use **Request approval** on the CLAs row to ask your employer's CLA managers to approve you again |
| **Revoked** (ECLA)          | Yes                  | This is a sanctions-screening outcome and cannot be changed from Self Serve                                                               |
| **Invalidated**             | No                   | That agreement no longer covers you, so you can sign again with the same identity                                                          |

## How do I ask my CLA manager to approve or remove my ECLA?

Three ECLA-only actions reach the CLA managers who hold your employer's Corporate CLA. None of them changes the agreement itself; a manager acts on it in the Corporate CLA Console.

- **Request approval** — offered when your ECLA is no longer on your employer's Approved List. It asks the managers to approve you again.
- **Request Removal** — offered on any ECLA that is not Revoked. It asks the managers to remove your ECLA, which starts the process of invalidating it on your behalf.
- **Contact CLA Manager** — offered on a Valid or Needs-attention ECLA. It sends a free-text message rather than a specific request, for anything the other two do not cover.

All three open the same dialog:

1. Self Serve loads the CLA managers for that agreement and pre-selects all of them. Clear anyone you would rather not contact.
2. Add a **Message**. This is optional for **Request approval** and **Request Removal**. It is required for **Contact CLA Manager**, where the message is the whole point of the action — **Send** stays disabled until you write one.
3. Select **Send**.

What you see afterwards:

| Outcome              | What it means                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Request sent**     | The managers you selected will be notified.                                                                               |
| **Request recorded** | The request was stored, but no manager email could be delivered. Follow up with your employer's CLA managers another way. |
| No managers listed   | _No CLA manager is currently reachable for this company._ Contact Linux Foundation support for help.                      |

**Contact CLA Manager** phrases the same two outcomes as _Message sent_ and _Message recorded_, because it carries a message rather than a request.

A recorded request or message is not a failure on your part and does not need re-sending — it means Self Serve stored it but your employer's CLA managers have no deliverable email address on file.

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

Yes for an **ICLA**, when EasyCLA has the signed file — choose **Download PDF** from the row's **⋮** menu. When EasyCLA does not have the file, the row offers no download. An **Invalidated** ICLA is the exception: the row carries no **⋮** menu at all, so there is nothing to download from it even when EasyCLA still holds the signed file.

No for an **ECLA**. Employee coverage is under your company's Corporate CLA (CCLA), so there is no individual PDF to download. On an ECLA that has a **⋮** menu, the menu shows **Download PDF** greyed out and annotated _Covered by Corporate CLA (CCLA)_. A **Revoked** ECLA has no menu at all, so it shows nothing.

## What Self Serve does not do

The CLAs tab shows your agreements and starts requests about them. It never:

- **Runs the signing ceremony.** The agreement is presented and signed in the EasyCLA Contributor Console. Self Serve only hands you off to it.
- **Approves, invalidates, or revokes an agreement.** Those changes are made by a CLA manager in the Corporate CLA Console, by a project maintainer, or by EasyCLA's own screening — never by this tab, including when you use **Request Removal**.
- **Edits your employer's Approved List.**

## Related

- [Account overview](../) — all account areas and navigation
- [Account FAQ](../faq/) — short answers to common account questions, including CLAs
- [Identities](../identities/) — link the Email and GitHub accounts your CLAs are matched against
- [Edit your profile](../../profile/edit-profile/) — name, photo, About Me, primary email, and location
- [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla) — CLA concepts, consoles, and troubleshooting outside Self Serve
