---
title: Settings
description: Manage your email addresses, password, two-factor authentication, developer API token, and LFX Insights API tokens in LFX Self Serve.
audience: [all]
product_area: Account
tags: [account, settings, email, password, developer, api-token, insights, insights-api, security, meeting-invitations]
last_updated: 2026-11-05
intercom_collection: Account
---

The Settings tab manages your account security and access credentials — email addresses, password and two-factor authentication, and your developer API token. It lives under the Profile & Account hub at `/profile/settings`.

## What you can do

- Add and verify email addresses
- Choose which verified address receives meeting invitations
- Change your password or send a reset link
- Set up two-factor authentication (when available)
- View and copy your Personal Access Token (API token)
- Create and revoke LFX Insights API tokens

## Open Settings

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select [**Profile & Account**](/profile) from the left navigation sidebar.
3. Open the **Settings** tab, or go directly to `/profile/settings`.

## Available settings

The Settings tab (`/profile/settings`) has three sections on one page — **Email Settings**, **Password**, and **Developer Settings**. On wide screens an **On this page** list on the left jumps between them.

### Email Settings

_Manage your email addresses. All email addresses are verified before they can be used._

The **Email Addresses** card lists every address on your account. Badges mark the **Primary** address, the address that receives **Meeting Invites**, and each **Verified** address. Addresses with available actions have a **⋮** menu that shows only those actions. Your primary address has none unless meeting invitations go to a different address.

| Action                          | When it appears                                                         |
| ------------------------------- | ----------------------------------------------------------------------- |
| **Make Primary**                | On a verified address that is not already primary                       |
| **Use for Meeting Invitations** | On a verified address that does not already receive meeting invitations |
| **Delete**                      | On any address except your primary, when you have more than one address |

**Delete** asks you to confirm in a **Delete Email Address** dialog. An address selected for meeting invitations can't be deleted until you choose a different one. You can also change your primary address from the [Edit Profile drawer](../../profile/edit-profile/#primary-email-address).

The **Meeting Invites** badge marks the address that receives meeting invitations — your primary address until you choose another. Meeting invitations stay on that address when you change your primary email; use **Use for Meeting Invitations** on another verified address to move them.

**To add an email address:**

1. Type the address in the **Add New Email Address** field and select **Send Code**. If the address can be added, a 6-digit verification code is sent to it. While the request is pending, the button shows **Requesting code…** and is disabled.
2. Enter the code in **Enter verification code** and select **Verify**.

If the code doesn't arrive, the **No code yet?** guidance asks you to check the email address and your spam or junk folder; **Contact support** is available from the start. After the cooldown, select **Resend code** once if needed. After one successful resend request, **Still waiting for your code?** appears with a prominent **Contact support** button. You can still enter a code if it arrives later. A failed resend shows **We couldn’t request another code. Please try again.** and does not use up your resend allowance.

Select **Use a different email** to return to an empty address form and start again; this action is disabled while requesting or verifying a code. If the address is already connected to your account, you see **This email is already connected to your account.** rather than a new address being added. Verifying may first ask you to authorize changes to your profile; when you return to Settings, LFX tells you if the email is already connected or if verification did not finish — in that case start email verification again and select **Send Code** to request a new code.

### Password

_Keep your account secure by using a strong password and enabling two-factor authentication._

- **Change Password** — fill in **Current Password**, **New Password**, and **Confirm New Password**, then select **Change Password**. A strength meter under **New Password** lists the requirements under _Requirements (must meet at least 3 of 4 criteria):_ — **At least 8 characters**, **Lowercase letter (a-z)**, **Uppercase letter (A-Z)**, **Number (0-9)**, and **Special character (!@#$%^&\*)**. The meter appears once you start typing a new password. **Reset** clears the form. If you don't know your current password, select **Forgot your password? Start the account recovery process.** under the **Current Password** field.
- **Account Recovery** — select **Send Reset Link** to email yourself a password reset link.
- **Two-Factor Authentication** — currently shows "Two-factor authentication settings are currently unavailable." The **Set up 2FA** button is disabled.

### Developer Settings

_Your API token provides programmatic access to LFX services._

The **API Token** card shows your **Personal Access Token**. Use **Show** to reveal it and **Copy** to copy it to your clipboard (the button briefly reads **Copied!**). If no token can be loaded, the card says "API token is currently unavailable."

The **Security Guidelines** box beside it explains how to handle the token:

- This token is short-lived and automatically regenerated by the system.
- Never share it publicly. Keep this token secure.
- Never commit this token to version control.

### LFX Insights API Tokens

The **LFX Insights API Tokens** card appears under **Developer Settings**, below the **API Token** card, and the Developer Settings subtitle reads _Your API tokens provide programmatic access to LFX services._

_Tokens for accessing the LFX Insights API. Pull project health and contribution data into your own dashboards, reports, and tools._ The **LFX Insights docs** link opens the API documentation.

**Create a token:**

1. Select **New token**. It's at the top of the card once you have tokens; before then, it's under _No LFX Insights API tokens yet._
2. In the **New LFX Insights API token** dialog, enter a **Token name** (for example, _Weekly health report_). Use 100 characters or fewer, with no tabs or line breaks, and a name you haven't used for another token.
3. Choose an **Expiration**: **30 days**, **60 days**, **90 days** (the default), **1 year**, or **No expiration**. The dialog shows the date it will expire, or _This token stays valid until you revoke it._
4. Select **Create token**.
5. In **Token successfully created**, select **Copy**. **Copy this token now.** For your security, the token is never shown again.

The **Using it** section of that dialog explains how to call the API: _Send this token as a bearer token. There's no separate token endpoint to call._

If you've reached the maximum number of tokens, the dialog asks you to remove an expired token or revoke one you no longer use, then try again.

**Your tokens:** each token in the list shows its name, a masked value, and a line such as _Created \<date\> · Last used \<time\> · Expires \<date\>_ (or _Never used_, or _Expires never_). An expired token shows _Expired_ and its date instead.

**Revoke or remove a token:**

- **Revoke** — on an active token. Confirm in the **Revoke "\<name\>"?** dialog — _Anything using this token will stop working within 10 minutes. This can't be undone._ — by selecting **Revoke token**.
- **Remove** — on an expired token. It's removed straight away, with no confirmation, because it already no longer works.

The Security Guidelines box adds: _Give each integration its own LFX Insights API token, so you can revoke one without affecting the others._

**If the card shows a message instead:**

- **LFX Insights API tokens aren't enabled for your account yet** — your account doesn't have access. If you'd like access, select **LFX Support** in the message.
- **We couldn't check if you are eligible** — _LFX Insights API tokens are unavailable right now. Please try again in a few minutes._ Select **Retry**.
- _We couldn't load your LFX Insights API tokens._ — select **Retry**.

## Save changes

Settings are NOT auto-saved. Each section has its own action button: **Send Code** / **Verify** for a new email, the **⋮** menu actions for an existing email, **Change Password** or **Send Reset Link** for your password, **Show** / **Copy** for the API token, and **New token** / **Revoke** for LFX Insights API tokens.

## Related

- [Account overview](../) — all account areas and navigation
- [Edit your profile](../../profile/edit-profile/) — name, photo, About Me, primary email, and location
- [Account FAQ](../faq/) — common questions about settings, transactions, and CLAs
