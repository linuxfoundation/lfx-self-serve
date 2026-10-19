---
title: EasyCLA
description: View and manage an organization's corporate CLAs in the Organization lens — the list, signing, CLA Managers, the Approved List, contributor acknowledgments, the activity log, and Auto Acknowledge.
audience: [all]
product_area: Organization
tags: [organization, easycla, cla, ccla, cla-manager, approval-list, signing]
last_updated: 2026-10-19
intercom_collection: Organization
---

These steps apply to anyone who can open **EasyCLA** for an organization in the Organization lens: an organization admin, a viewer, Linux Foundation staff with access to that organization, or a CLA Manager whose only Organization lens page is EasyCLA.

**EasyCLA** lists the corporate CLAs (Contributor License Agreements) the selected organization holds. A CLA is the agreement that covers contributions to a Linux Foundation project that requires one. A **CCLA** (Corporate CLA) is the agreement a company signs so its people can contribute under the company's name. EasyCLA answers: which corporate CLAs does this organization hold, who can change each one, and what still needs a signature?

Signing hands off to DocuSign. Self Serve prepares the agreement and does not run the DocuSign ceremony. See [What does Self Serve leave to DocuSign?](#what-does-self-serve-leave-to-docusign).

For what a CLA is, and for the project and corporate consoles outside Self Serve, see the [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla). Your own signed agreements, as a contributor, are on [CLAs](../../account/my-clas/).

## Where do I find EasyCLA?

EasyCLA is under **EasyCLA Management** in the Organization lens.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Switch to the **Organization** lens and select the organization.
3. Open **EasyCLA Management**, then **EasyCLA**, or go directly to `/org/<organization>/easycla`.

A CLA Manager who has no other Organization lens role on that organization sees **EasyCLA Management** and nothing else in the sidebar. The rest of the Organization lens stays closed to them.

If no organization is selected, the page says **No org selected** and asks you to select one. The detail page says **Select an organization**.

## Who can see EasyCLA, and who can change a corporate CLA?

You can open EasyCLA when you have an Organization lens role on that organization. You can change a corporate CLA only when you are a CLA Manager named on that agreement, and a role added or removed in the last 30 minutes may not have taken effect yet.

| Who you are                                            | What you can see                                                                           | What you can change                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Organization admin or viewer                           | Every corporate CLA of the company                                                         | Only a corporate CLA you are named on as a CLA Manager. The company's other corporate CLAs stay read-only. |
| Linux Foundation staff with access to the organization | That organization's EasyCLA page                                                           | Only a corporate CLA you are named on as a CLA Manager                                                     |
| CLA Manager with no other Organization lens role       | EasyCLA only. The rest of the Organization lens stays closed.                              | Only the corporate CLAs you are named on                                                                   |
| Someone with no EasyCLA role at the organization       | The page title **We couldn't load your CLAs**, with the reason in the text under the title | Nothing on this page                                                                                       |

The name on the CLA Manager list has to match your LF username exactly, including capitalization. A difference only in case does not count as a match.

A CLA Manager role that was just added or just removed can take about 30 minutes before every control matches the list. Reload the page after waiting. If you remove yourself, this page updates your own controls when the list reloads, so you do not keep managing that agreement from this page while you wait.

**We couldn't load your CLAs** is two different failures, and the text under the title says which one:

- **You don't have an EasyCLA role at this organization.** The page then offers **contact support** if you need EasyCLA assistance. That button opens support. It is not the reason the page is empty.
- **Something went wrong fetching this organization's corporate CLAs.** Refresh the page to try again. That failure is not a statement about your role.

Companies you cannot open in the Organization lens are still managed in the [Corporate CLA Console](https://corporate.lfcla.com). Membership does not by itself decide who appears in the organization selector: Linux Foundation staff can open organizations that are not members.

## What does the EasyCLA list show?

The EasyCLA list is one card per corporate CLA the organization has signed. Search those cards by project, foundation, or CLA name.

Each card shows:

- The CLA Group name
- **Signed by** the signing entity, when that entity differs from the organization and the agreement is signed. Two cards can share a CLA Group name when the organization signed under more than one entity.
- A coverage chip. One project is named on its own and opens nothing. Several projects show the foundation name, when there is one, and a **Covers N projects** chip that opens the project list.
- A **Signed** pill when the agreement is signed. A sanctioned organization has no status pill on the card. See [What does a sanctioned organization look like on EasyCLA?](#what-does-a-sanctioned-organization-look-like-on-easycla).
- A count of **approval entries** (the rules on the Approved List) and a count of **CLA Managers**. An approval-entry count the page could not read shows as an em dash, not as zero, so a zero approval-entry count means the page read it and it is zero. A CLA Manager count the page could not read shows as zero, so zero CLA Managers on the card is not proof there are none. The **CLA Managers** tab lists the managers themselves. There is no separate "needs a CLA Manager" flag on the card.

Search uses the box labeled **Search CLAs…**. **Previous** and **Next** move between pages of cards. A search with no hits says **No CLAs match your search**. An organization with no signed corporate CLAs shows a title made of the organization name plus **hasn't signed any CLAs yet**, and points you at **Sign CLA**.

**Not started** is not a pill on this list. The list is signed agreements. **Not yet signed** is the heading on the preview you reach by starting **Sign CLA**, before a signature exists.

Open a card to see that agreement. A card with no CLA Group id cannot be opened as a link.

## How do I sign a corporate CLA?

Signing a corporate CLA starts on EasyCLA and finishes in DocuSign. Self Serve prepares the agreement and does not run the DocuSign ceremony.

1. On EasyCLA, select **Sign CLA**.
2. In **Sign a CLA**, search for the project, CLA Group, or repository, then select **Continue to sign**.
3. On the agreement, select **Start the CLA process**. If you are not already the initial CLA Manager, the page asks **Are you authorized to be a CLA Manager for your organization?**
   - **Yes** shows **Configuring CLA Manager Settings…** while you are made the initial CLA Manager designee, then closes. Overview then says **You've been identified as the initial CLA Manager from your company for this project.** and offers **Proceed with signing**. You can leave and select **Proceed with signing** later. Select it to continue to step 4.
   - **No** asks you to **Identify CLA Manager** — a name and email for the person at your company who will be the CLA Manager. That person needs an LF Login before they can become the designee. Answering **No** ends your part: Overview shows a notice, and no confirmation screen follows.

   If you are already the initial CLA Manager designee, Overview offers **Proceed with signing** instead of **Start the CLA process**, and the question is not asked. Steps 4 to 6 are for the person continuing as the initial CLA Manager.

4. **Confirm Authorization to Sign the CLA** offers **Cancel**, **I am not authorized**, and **Continue**. Choose the branch that fits:
   - **You sign it yourself.** Complete **Authorization Confirmation** and **Compliance Confirmation**, then select **Continue**. **Continue** stays disabled until both are complete. Compliance Confirmation is the export-control and sanctions statement on that screen, including the Office of Foreign Assets Control (OFAC) condition. The statement stays on that screen. This article does not repeat it.
   - **Someone else signs it.** Select **I am not authorized**. You do not complete either confirmation for this branch.
5. If you selected **Continue**, the screen says **Review CCLA** and offers **Review and Sign CCLA**. That opens DocuSign. After you return, the page may say **Confirming your signature with EasyCLA. This can take a few seconds.**
6. If you selected **I am not authorized**, **Identify who should sign** asks for the signatory's name and email. Select **Send Signature Request Email**. The form does not ask for an LF Login. You remain the initial CLA Manager once they sign.

Some rows in the picker stay visible and still cannot be signed from here:

- **This CLA group covers several projects and cannot be signed from here.**
- **This CLA group does not offer a corporate CLA.**
- **Your organization has already signed a corporate CLA for this CLA group.**
- **Signing CLA using GitLab is not supported from Self Serve.**

Before a signature exists, Overview explains the three steps: identify the initial CLA Manager, that person signs or sends the agreement to someone else, then the CLA Manager approves contributors and adds other CLA Managers. If you are already the initial CLA Manager designee, Overview says so instead and offers **Proceed with signing**. You can **Download a copy of the CCLA for review (non-executable)** from that preview. Approval List, Contributor Acknowledgments, and Activity Log stay empty until the agreement is signed, and each tab says so. CLA Managers says **CLA Managers become available once this CLA is signed**.

If you are not designated to sign, attestation **Continue** shows **Can't start signing** with **You aren't designated to sign this corporate CLA for your organization.** A grant made in the last half hour may not have arrived yet. Wait, then try again.

A direct link to a CLA Group this organization has not signed says **This CLA Group can't be previewed here yet** and sends you back to EasyCLA, where **Sign CLA** lives. A link that does not match an agreement says **This CLA was not found**.

## What does each tab on a corporate CLA show?

A corporate CLA has five tabs: **Overview**, **CLA Managers**, **Approval List**, **Contributor Acknowledgments**, and **Activity Log**.

### What does Overview show?

Overview states whether this organization has signed the agreement, who signed it, when, and whether **Auto Acknowledge** is on.

The card heading is the CLA Group name followed by **Signed**, **Not yet signed**, or **Unavailable**. **Unavailable** is the sanctioned state. It is not a second word for "not signed." A sanctioned agreement may already be signed. The heading uses **Unavailable** either way, and the signed date is what tells you a signature exists.

When a signed date is on record, Overview says **Signed by \<name\> on \<date\>.** or, when no signer name is on record, **Signed on \<date\>.** **Download signed CCLA PDF** is on every signed agreement. It works when you are a CLA Manager named on that agreement. See [Why is a control missing or disabled?](#why-is-a-control-missing-or-disabled).

A signed agreement also shows **Recent activity** on Overview, with a way into the Activity Log.

### How do I add or remove a CLA Manager?

Add or remove a CLA Manager from the **CLA Managers** tab, and only if you are a CLA Manager named on that corporate CLA.

The tab lists each manager's name and email under **Manager**, with the role **CLA Manager**. The introduction on the tab says CLA Managers maintain this CLA's approval list, and that a CLA Manager who will contribute code should add themselves to the Approved List.

To add someone:

1. Select **Add CLA Manager**.
2. Enter **First name**, **Last name**, and email.
3. Submit.

The person needs an LF Login, and an LF username, before they can be added. The page says so when either is missing. Someone who is already a CLA Manager for this CLA cannot be added again.

To remove someone, select **Remove** on their row and confirm. You can remove yourself. The last CLA Manager cannot be removed: **Remove** is disabled on that row, with **A CLA must always have at least one CLA Manager.** under it. Add another CLA Manager first.

On an agreement that is already signed and lists no CLA Managers, **Add CLA Manager** stays disabled. Only someone already named on the agreement can add another, so the first manager cannot be added from this page. That record needs EasyCLA support. On an agreement that is not signed yet, the initial CLA Manager is identified during [signing](#how-do-i-sign-a-corporate-cla), not from this tab.

### What is on the Approval List?

The **Approval List** tab is the company's **Approved List**: the rules that decide who is covered under this corporate CLA. The heading on the tab is **Approved List of Contributors from My Organization**. The count beside it counts rules, not people.

You can add, edit, and delete entries when you are a CLA Manager named on this agreement. The types, in the order the picker offers them, are:

| Type                | What you enter                                 |
| ------------------- | ---------------------------------------------- |
| **Email domain**    | A domain, such as `example.com`                |
| **Email**           | One address, such as `contributor@example.com` |
| **GitHub org**      | A GitHub organization login                    |
| **GitHub username** | One GitHub username                            |
| **GitLab group**    | A GitLab group URL                             |
| **GitLab username** | One GitLab username                            |

Search uses **Search approval list…**. Select **Add entries** to add rules.

Editing an entry warns, before you save: **Contributors covered only by the previous value will show as Not Authorized until you add it back.** Removing an entry reports: **The entry was removed. Acknowledgments it covered now show as Not Authorized.** **Not Authorized** means the rule that covered that person was removed. It is not the same as **Invalidate**, which is a deliberate revocation on the Contributor Acknowledgments tab.

Until the agreement is signed, the tab says **The approval list becomes available once this CLA is signed.**

### What are contributor acknowledgments?

Contributor acknowledgments are the records of people who have acknowledged they are covered by this corporate CLA. The tab heading is **Contributor Acknowledgments from My Organization**.

Search uses **Search contributors…**. Each row shows **Name**, **LF Login/GitHub or GitLab ID**, **Acknowledged On**, and **Status**:

| Status             | What it means                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| **Authorized**     | The acknowledgment is in force                                                                            |
| **Not Authorized** | The Approved List rule that covered this person was removed. Add the rule back if they should be covered. |
| **Invalidated**    | A CLA Manager invalidated the acknowledgment on purpose                                                   |

To invalidate an acknowledgment, select **Invalidate** on that row and confirm **Invalidate acknowledgment**. Invalidating does not by itself delete the Approved List rule. The confirmation says whether a matching individual entry should also be removed so the person cannot acknowledge again, and it says **Auto Acknowledge won't re-add them** once they are invalidated. If they still match a broader rule, such as an email domain or a GitHub org, they can acknowledge again unless that rule is removed too.

A signed agreement with no acknowledgments yet says **No contributor acknowledgments yet** and **No employee has acknowledged this agreement yet.** Until the agreement is signed, the tab says **No contributor acknowledgments yet** and explains that people appear here after signing.

In prose, this record is an **employee acknowledgment**, and the switch that grants it automatically is **Auto Acknowledge**.

### What does the Activity Log show?

The Activity Log is the record of changes to this corporate CLA. The heading is **Activity log**, and the line under it says it covers signing status, CLA Managers, and the approval list.

Search uses **Search activity…**. Columns are **Action**, **By**, and **When**. **Load more** fetches the next page. There are no Previous and Next buttons on this tab. A search with no hits says **No matching activity** and tells you to clear the search.

Until the agreement is signed, the tab says **The activity log becomes available once this CLA is signed.**

## What does Auto Acknowledge do?

**Auto Acknowledge** is the switch on Overview that decides whether people who match the Approved List receive an employee acknowledgment automatically.

- **On** — employees matching the approval list are covered automatically.
- **Off** — employees matching the approval list still need to individually acknowledge this CLA before they're covered.

The switch is on every signed corporate CLA you can open, so you can see whether it is on. You can change it only when you are a CLA Manager named on that agreement and your access allows the change. It is hidden on the preview of an agreement that has not been signed, because there is no signature to store the setting on yet.

The switch is labelled **Auto Acknowledge** on Overview.

## What does a sanctioned organization look like on EasyCLA?

A sanctioned organization is shown as unavailable: the card has no status pill, and the Overview heading ends with **Unavailable**. EasyCLA does not show a standing banner on the page.

Signing that organization, and changing its corporate CLA, is refused. If you answer **Are you authorized to be a CLA Manager for your organization?** while signing for that organization, the error says **Your organization cannot sign this CLA at this time. Contact support for more information.** A refusal at any other step is an error shown when you try that step. Neither is a banner above the page.

**Unavailable** does not tell you whether a signature already exists. A sanctioned agreement that was signed still shows its signed date, its CLA Managers, and **Download signed CCLA PDF**, which works when you are a CLA Manager named on that agreement. An agreement that was never signed does not offer the download, and Overview does not walk you through how to start signing.

## Why is a control missing or disabled?

A control you cannot use is usually disabled or absent. The table shows what you see for each one, and the sentence the page uses when it shows one.

| What you tried               | What you see                                                                                                                                                                                                                        | The words                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Add or remove a CLA Manager  | When you are not on the CLA Manager list, **Add CLA Manager** is disabled with the sentence and **Remove** is hidden. A CLA Manager on the list can lose either control, depending on which access is denied, and sees no sentence. | `Only a CLA Manager named on this CCLA can add or remove CLA Managers`   |
| Download the signed document | **Download signed CCLA PDF** is disabled                                                                                                                                                                                            | `Only a CLA Manager named on this CCLA can download the signed document` |
| Change **Auto Acknowledge**  | The switch is disabled. The sentence under it appears only when you are not on the CLA Manager list. A CLA Manager on the list whose access is denied sees no sentence.                                                             | `Only CLA Managers can change this setting.`                             |
| Change the Approval List     | **Add entries**, edit, and delete are absent. If a change is still refused, an error says the sentence below.                                                                                                                       | `Only a CLA manager named on this CLA can change its approval list.`     |
| Invalidate an acknowledgment | **Invalidate** is absent. If a change is still refused, an error says the sentence below.                                                                                                                                           | `Only a CLA manager named on this CLA can invalidate acknowledgments`    |

A CLA Manager who was added or removed in the last 30 minutes can see these disagree with the list until access catches up. Reload after waiting. See [Who can see EasyCLA, and who can change a corporate CLA?](#who-can-see-easycla-and-who-can-change-a-corporate-cla).

## What does Self Serve leave to DocuSign?

Self Serve does not run the DocuSign ceremony, and it does not record the signature itself. **Review and Sign CCLA** opens DocuSign. EasyCLA writes the signature when DocuSign calls back, which is why the return trip can sit on **Confirming your signature with EasyCLA** for a few seconds.

Sending the agreement by email also leaves the signature to the signatory. Self Serve sends the request. It does not sign on their behalf.

## Related sections

- [EasyCLA FAQ](../faq/) — short answers for editing, missing companies, access after removal, and a first CLA Manager
- [CLAs](../../account/my-clas/) — your own Individual CLA (ICLA) and your coverage under an employer's corporate CLA
- [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla) — CLA concepts, consoles, and troubleshooting outside Self Serve
- [Corporate CLA Console](https://corporate.lfcla.com) — corporate CLAs for a company you cannot open in the Organization lens
