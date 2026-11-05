---
title: Account FAQ
description: Frequently asked questions about account settings, affiliations, identities, CLAs, transactions, and billing in LFX Self Serve.
audience: [all]
product_area: Account
tags: [account, faq, settings, affiliations, cla, easycla, transactions, billing, privacy, contributions, github]
last_updated: 2026-11-05
intercom_collection: Account
---

## What is the difference between Account and Profile?

**Profile** is your personal identity — your name, photo, About Me, primary email, and location, edited in the Edit Profile drawer. **Account** covers everything else tied to your Linux Foundation account: work history and affiliations, connected identities, individual enrollment, CLAs, transactions, and settings (email, password, and developer API token). Both live under the **Profile & Account** hub.

## How do I change my email address?

Email addresses are managed in the **Settings** tab (`/profile/settings`). Go to **Settings** > **Email Settings** > **Add New Email Address**, enter the address, then select **Send Code**. If the address can be added to your account, a 6-digit verification code is sent to it; enter it to confirm the address. The **No code yet?** guidance asks you to check the email address and your spam or junk folder; **Contact support** is available from the start. After the cooldown, select **Resend code** once if needed. While the request is pending, the button shows **Requesting code…** and is disabled. After one successful resend request, **Still waiting for your code?** appears with a prominent **Contact support** button. You can still enter a code if it arrives later. A failed resend shows **We couldn’t request another code. Please try again.** and does not use up your resend allowance. Select **Use a different email** to return to an empty address form and start again; this action is disabled while requesting or verifying a code. To choose which verified address is primary, use the [Edit Profile drawer](../../profile/edit-profile/).

## How do I change my password?

Go to the **Settings** tab (`/profile/settings`) > **Password** > **Change Password**. Fill in **Current Password**, **New Password**, and **Confirm New Password**, then select **Change Password**. Use **Send Reset Link** if you have forgotten your current password.

## Where are developer settings (API token)?

Developer settings are in the **Settings** tab (`/profile/settings`) > **Developer Settings**. Use the **Show** button to reveal your Personal Access Token and the **Copy** button to copy it.

## Are my settings shared across devices?

Account settings (email, password, API token) are tied to your LFX account and apply across all devices.

## Does LFX Self Serve have notification preferences?

LFX Self Serve does not currently include a notification preferences section. Email and password settings are managed in the **Settings** tab (`/profile/settings`).

## How do I add or edit my work history?

Go to [**Profile & Account**](/profile) and use the **Work history & Affiliations** tab (`/profile/attributions`, the default tab). Select **Add work experience**, enter the organization, role, and dates (or mark **I currently work here**), then select **Add experience**. Use the actions menu on an entry to **Edit** or **Delete** it. Your work history also populates the **Organization** choices in the Edit Profile drawer. See [Work history & Affiliations](../work-history/).

## What are affiliations, and how are my contributions attributed?

Affiliations are the Linux Foundation projects and organizations you are associated with. They are calculated automatically from your **verified identities**, your **work experience**, and the overlap between your contribution timestamps and your employment dates — you don't add projects manually. View and adjust them on the **Work history & Affiliations** tab (`/profile/attributions`); you can confirm your affiliation history and override anything the system gets wrong. See [Work history & Affiliations](../work-history/).

## I'm listed as a contributor on a project. How do I get maintainer access?

The **Maintainer** and **Contributor** labels on your projects describe your involvement only; neither grants access. Access to a project (**View**, **Manage**, or **Meeting Coordinator**) is granted by a project manager on the project's **Permissions** page. Contact a project manager for the project and ask them to add you with the role you need. If you don't know who that is, contact support. See [Permissions](../../permissions/).

## Why don't my GitHub contributions show up?

LFX shows contributions to open source projects that LFX tracks, such as the projects you can find in LFX Insights. Commits, pull requests and issues in a personal repository, or in any project LFX doesn't track, are not counted, even when your GitHub account is linked and verified.

For contributions to a tracked project to appear, the GitHub account or email address you contributed with must be a **verified** identity on the **Identities** tab (`/profile/identities`). Your contributions are listed under **Project Involvement** on the **Work history & Affiliations** tab (`/profile/attributions`).

Your public profile settings don't affect this. They only control what other people see at `app.lfx.dev/u/<username>`. See [Do I need a public profile to see my own contributions?](../../profile/faq/#do-i-need-a-public-profile-to-see-my-own-contributions).

## How do I link a GitHub or social account?

Go to [**Profile & Account**](/profile) and open the **Identities** tab (`/profile/identities`). Select **Add identity**, then **Continue with _[provider]_** for a social account, or **Add email** to link and verify an email address. Linked identities attribute your contributions across projects. See [Identities](../identities/).

## What is an unverified identity, and how do I verify it?

An unverified identity is an account connected to your profile that hasn't been confirmed yet. On the **Identities** tab, find it under **Unverified identities** and select **Verify** (or **This is not me** if it isn't yours). Verifying keeps your project affiliations and work history accurate. See [Identities](../identities/).

## What is the Linux.com email alias?

The Linux.com email alias is a one-time add-on for Individual Supporters that gives you a personal `@linux.com` address forwarding to an inbox you choose. Manage it in the **Linux.com email** section of the [Identities](../identities/) tab — purchase, then claim an alias and a forward-to address. The alias can't be changed after claiming.

## How do I enroll as an Individual Supporter?

Go to [**Profile & Account**](/profile) and open the **Individual Enrollment** tab (`/profile/individual-enrollment`). Review the membership and its benefits, then select **Enroll as an Individual Supporter**. See [Individual Enrollment](../individual-enrollment/).

## How do I turn off auto-renew or stop my membership?

If your membership supports automatic renewal, the **Individual Enrollment** tab shows a **Disable auto-renew** control — select it and confirm. Your membership then stays active until its expiration date and won't renew automatically; there is no separate immediate-cancel step. Memberships that renew manually don't show an auto-renew control. See [Individual Enrollment](../individual-enrollment/).

## Where do I find CLAs?

Go to [**Profile & Account**](/profile) and open the **CLAs** tab (`/profile/clas`). For full detail, see [CLAs](../my-clas/).

## What is the difference between an ICLA and a CCLA?

An **ICLA** (Individual CLA) is an agreement you signed as yourself — you can download its PDF from the CLAs tab when EasyCLA has the file. A **CCLA** (Corporate CLA) is your employer's agreement; you're covered under it once approved via the company's **Approved List**. The CLAs tab lists your CCLA coverage with the company name and no individual PDF. See [CLAs](../my-clas/).

## Why don't my signed CLAs show up on the CLAs tab?

The CLAs tab matches agreements to your LF username, verified emails, and linked GitHub accounts. If those values do not match the identity you used when signing (for example a work email or GitHub account that is not linked to this LFX profile), the CLA will not appear. Open [Identities](/profile/identities), link the Email or GitHub accounts you used when signing, then return to **CLAs**. More detail: [Why don't my signed CLAs show up?](../my-clas/#why-don-t-my-signed-clas-show-up).

## Can I sign a CLA from the CLAs tab?

No. The CLAs tab lists the agreements EasyCLA already has on file for you. You sign a new CLA in EasyCLA — see the [EasyCLA documentation](https://docs.linuxfoundation.org/lfx/easycla).

## Can I download my signed CLA PDF?

You can download a signed **ICLA** (Individual CLA) when EasyCLA has the file — select **Download PDF** in that row's **Document** column. If EasyCLA does not have the file, the column shows _PDF unavailable_. There is no PDF for coverage under a **CCLA** (Corporate CLA), because that coverage sits under your employer's agreement rather than an agreement of your own; the column shows _Covered by Corporate CLA (CCLA)_. See [Can I download my signed CLA PDF?](../my-clas/#can-i-download-my-signed-cla-pdf).

## How do I get my employer's CLA manager to approve or remove my CCLA coverage?

Contact your employer's CLA manager directly. The CLAs tab doesn't send requests, and only a CLA manager can change the company's **Approved List**, in the Corporate CLA Console. See [What Self Serve does not do](../my-clas/#what-self-serve-does-not-do).

## What purchases appear in my transaction history?

Your transaction history includes all purchases made through the LFX platform under your account, such as training course enrollments, certification exams, and event registrations. See [Transactions](../transactions/).

## Can I download a receipt or invoice?

Not from LFX Self Serve — the **Transactions** tab (`/profile/transactions`) lists your purchases but has no receipt or invoice download.

- **Training courses, certification exams, bundles, and subscriptions** — contact the LF Education support team at [trainingsupport.linuxfoundation.org](https://trainingsupport.linuxfoundation.org) and include your order ID.
- **Event registrations** — download the invoice receipt PDF from the **Payment Information** section of your registration confirmation email; turn off any pop-up blockers first. If you can't find the email, contact LFX support.
- **Anything else** — contact LFX support.

See [Get a receipt or invoice](../transactions/#get-a-receipt-or-invoice).

## Why is a purchase missing from my transaction history?

Recent purchases may take up to 48 hours to appear in LFX Self Serve. If a purchase is still missing after 48 hours, contact LFX support with your order confirmation.

## Can I request a refund through LFX Self Serve?

No — there is no refund request in LFX Self Serve. For a training course, certification exam, bundle, or subscription, contact the LF Education support team at [trainingsupport.linuxfoundation.org](https://trainingsupport.linuxfoundation.org) with your order ID. For other purchases, contact LFX support with your order confirmation.

## Who can see my transactions?

You can only see your own transactions. Other users and project administrators cannot access your billing history.

## I was charged incorrectly. Who do I contact?

For a training course, certification exam, bundle, or subscription, contact the LF Education support team at [trainingsupport.linuxfoundation.org](https://trainingsupport.linuxfoundation.org). For other purchases, contact LFX support. Either way, include the transaction date, amount, item name, and order ID so the team can investigate.

## How do I delete my account or personal data?

You can't delete your Linux Foundation account from LFX Self Serve. To request deletion of your account or personal data, email privacyrights@linuxfoundation.org. See the [Linux Foundation Privacy Policy](https://www.linuxfoundation.org/legal/privacy-policy) for how your data is handled.

## Who do I contact if a setting isn't working?

Contact LFX support. Describe the setting you changed and the behavior you expected.
