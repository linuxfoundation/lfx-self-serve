---
title: Identities
description: Link, verify, and remove the social and email identities used to attribute your work in LFX Self Serve; GitLab linking is coming soon
audience: [all]
product_area: Account
tags: [account, identities, github, gitlab, email, verification, linux-com-alias, meeting-invitations, merge-accounts]
last_updated: 2026-11-11
intercom_collection: Account
---

The **Identities** tab is where you manage the accounts used to identify you and attribute your contributions across Linux Foundation projects — your GitHub and social accounts and your verified email addresses. Keeping these linked and verified helps ensure accurate project affiliations and work history. It lives under the Profile & Account hub at `/profile/identities`. GitLab account linking is coming soon.

## What you can do

- Link a new GitHub, social, or email identity to your account
- Verify an identity that is connected but not yet confirmed
- Remove an identity you no longer want linked
- Ask support to merge a second LFX account into this one
- Claim and manage a personal **Linux.com email** alias (an Individual Supporter add-on)

## Open Identities

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select [**Profile & Account**](/profile) from the left navigation sidebar.
3. Open the **Identities** tab, or go directly to `/profile/identities`.

## Verified vs unverified identities

Identities are grouped into two sections:

- **Verified identities** — accounts you have confirmed. A verified identity that is your primary shows a **Primary** badge.
- **Unverified identities** — accounts connected to your profile that still need confirmation. You will see a reminder to verify them so your project affiliations and work history stay accurate.

Your primary email is always listed, with a **Primary** badge. If you also sign in with Google or an email login that uses the same address, that account stays listed and can still be removed to unlink it. If your sign-in hasn't confirmed it as verified, it shows under **Unverified identities** with the badge but without **Verify** or **This is not me** — it can't be verified or removed from this page. If it should show as verified, contact support.

The profile sidebar and the **Primary** badge use your current primary email. Changing it in **Edit profile** refreshes both displays without signing out and back in.

> **Note:** A single identity can only be linked to one LFX account. For email addresses, LFX shows the same code-entry step whether or not the address is already linked elsewhere, and only tells you the address is already linked after you enter the correct code — the code is what proves you own the inbox. The **No code yet?** guidance asks you to check the email address and your spam or junk folder, and **Contact support** is available from the start. After one successful resend request, **Still waiting for your code?** appears with a prominent **Contact support** button. You can still enter a code if it arrives later. Social-account conflicts still show a conflict message after provider sign-in. Signing in again with a social account that is already yours shows **Already connected** instead. If the identity is linked to another LFX account that is also yours, ask support to merge the two accounts — see [Merge two LFX accounts](#merge-two-lfx-accounts).

## Add an identity

1. Select **Add identity**.
2. Choose a provider:
   - For a social account, select **Continue with GitHub**, **Continue with LinkedIn**, or **Continue with Google** and complete the provider's sign-in. Linked identities are used to attribute contributions and participation across projects.
   - **Continue with GitLab** is disabled while GitLab account linking is being prepared. The GitLab row shows **Coming soon**, and hovering over or focusing the disabled button's surrounding area shows the same explanation. You cannot start a new GitLab connection from this dialog yet.
   - If that social account is already connected to your own account, LFX confirms **This identity is already connected to your account.** instead of linking it again, and refreshes your identities. Nothing new is linked.
   - For an email address, select **Add email**, enter the address, and select **Send verification code**. A 6-digit code is sent to the address; enter that code and select **Verify email**. A wrong or expired code shows **Verification failed. Please try again or request a new code.** After the cooldown, use **Resend code** once if needed. The button shows **Requesting code…** and is disabled while the request is pending. A failed resend shows **We couldn’t request another code. Please try again.** and does not use up your resend allowance. After one successful resend request, the **Still waiting for your code?** callout directs you to **Contact support**, while code entry remains available. To correct the address, select **Use a different email** without closing the dialog; the action is disabled while requesting or verifying a code.
   - If the address turns out to be already connected to your own account, LFX still asks for the code — the code is what proves you own the inbox — and then confirms **This email is already connected to your account.** instead of adding it a second time. If the code is correct but the address is already linked to an LFX account, the dialog shows **This email is already linked to an LFX account. If you believe this is an error, contact support.** with a **contact support** link. The address is not added, and a new code won't change the outcome.

## Verify an unverified identity

1. Find the account under **Unverified identities**.
2. Select **Verify**.
   - For a social account, select **Continue with _[provider]_** to confirm through the provider. If the account is already connected to yours, LFX confirms **This identity is already connected to your account.** and refreshes your identities. That message is not a new verification. If the row still shows under **Unverified identities** after the refresh, contact support rather than signing in again.
   - For an email address, select **Send verification code**, then enter the 6-digit code and select **Verify identity**. The address stays fixed to the identity you selected. **Contact support** is available immediately and becomes the prominent action after one successful resend request; you can still enter a code if it arrives later. If the address is already connected to your account, LFX confirms **This email is already connected to your account.** and refreshes your identities. If the code is correct but the address is already linked to an LFX account, the dialog shows the same already-linked message with a **contact support** link.

If an unverified identity is not yours, select **This is not me** to reject it, then confirm with **Remove** in the **Remove unverified identity** dialog.

To verify an email identity, use its own **Verify** action and enter the code sent to that inbox. Signing in to LinkedIn proves access to LinkedIn; an **Already connected** notice is not proof that the email identity was verified. Check the email row after the refresh and, if it remains unverified, verify it with its own code.

## Remove an identity

1. Open the actions menu on a verified identity and select **Remove**.
2. In **Remove verified identity**, check _I understand that removing this verified identity may affect my contribution attribution_, then select **Remove identity**.

If LFX cannot unlink the account, it shows _Failed to remove identity. Please try again._ The identity stays connected; try removing it again later.

To reject an unverified identity instead, use **This is not me** on its row (see [Verify an unverified identity](#verify-an-unverified-identity)). Your primary email itself can't be removed. If a Google or email login uses your primary address, you can remove that login to unlink it. The primary email stays listed.

> **Note:** Removing an identity can't be undone. As the removal dialog notes, identity information may be retained to help improve our services and support project insights — see the [Linux Foundation Privacy Policy](https://www.linuxfoundation.org/legal/privacy-policy) for what data is kept and why.
>
> A verified email currently set to receive meeting invitations can't be removed — its **Remove** option is disabled, with the tooltip _This email is set for meeting invitations. Choose a different meeting-invitation email in Account Settings before removing it._ Choose a different meeting-invitation email in [Settings](../settings/#email-settings) first.

## Merge two LFX accounts

If you have more than one LFX account — for example, a personal account and a work account — LFX support can merge them into one. There is no merge option in LFX Self Serve, and you don't need to delete either account first.

To request a merge, contact support and include:

- The LFX usernames (LFIDs) or email addresses of both accounts
- Which account you want to keep

Merging LFX accounts does not move training course or certification exam records between accounts.

## If the Identities tab shows a message

- **Identity service unavailable** — _Identity verification status cannot be loaded right now. Please try again in a few minutes._
- _This identity is already linked to another LFX account. A single identity can only be linked to one account._ — the account you just signed in with belongs to a different LFX account. If you believe this is an error, select **contact support** in the message. If that other account is also yours, ask support to [merge the two accounts](#merge-two-lfx-accounts).
- **No identities found** — _No connected accounts were found for your profile._ Use **Add identity** to link one.

## Your Linux.com email alias

The **Linux.com email** section, at the bottom of the Identities tab, lets Individual Supporters set up a personal `@linux.com` address that forwards to an inbox you choose. The Lifetime Linux.com Email Alias is a one-time add-on.

- **Purchase** — if you have not bought the add-on yet, select **Purchase Email** to complete the one-time purchase.
- **Claim** — once purchased, choose **Your alias** and a **Forward to** address, then select **Claim alias**. Aliases use letters, numbers, dots, and hyphens (up to 64 characters) and **cannot be changed after claiming**.
- **Manage forwarding** — after claiming, your alias shows an **Active** badge. To change where it forwards, pick a different verified address under **Forward to** and select **Save**.

> **Note:** You need at least one verified email address to forward to. If you don't have one yet, add and verify an email first (see [Add an identity](#add-an-identity) or [Settings](../settings/)), then return here.

## Related

- [Account overview](../) — all account areas and navigation
- [CLAs](../my-clas/) — linked Email and GitHub identities are how signed CLAs are matched to you
- [Settings](../settings/) — add and verify email addresses, manage your password and API token
- [Account FAQ](../faq/) — short answers about identities, settings, and CLAs
