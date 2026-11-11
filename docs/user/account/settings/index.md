---
title: Settings
description: Manage your email addresses, password, two-factor authentication, and developer API token in LFX Self Serve.
audience: [all]
product_area: Account
tags: [account, settings, email, password, developer, api-token, security, meeting-invitations]
last_updated: 2026-11-11
intercom_collection: Account
---

The Settings tab manages your account security and access credentials — email addresses, password and two-factor authentication, and your developer API token. It lives under the Profile & Account hub at `/profile/settings`.

## What you can do

- Add and verify email addresses
- Choose which verified address receives meeting invitations
- Change your password or send a reset link
- Set up two-factor authentication (when available)
- View and copy your Personal Access Token (API token)

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

1. Type the address in the **Add New Email Address** field and select **Send Code**. LFX shows the same confirmation whether or not the address is already linked to an LFX account, and the 6-digit verification code is sent to that address. While the request is pending, the button shows **Requesting code…** and is disabled.
2. Enter the code in **Enter verification code** and select **Verify**.

If the code is wrong or has expired, you see **Verification failed. Please try again or request a new code.** — enter the code again or request a new one. If the code is correct but the address is already linked to an LFX account, you see **This email is already linked to an LFX account. Contact support if you need help.** The address is not added, and requesting a new code won't change the outcome; contact support if you need the address moved to this account. If the address belongs to another LFX account of yours, support can [merge the two accounts](../identities/#merge-two-lfx-accounts).

If the code doesn't arrive, the **No code yet?** guidance asks you to check the email address and your spam or junk folder; **Contact support** is available from the start. After the cooldown, select **Resend code** once if needed. After one successful resend request, **Still waiting for your code?** appears with a prominent **Contact support** button. You can still enter a code if it arrives later. A failed resend shows **We couldn’t request another code. Please try again.** and does not use up your resend allowance.

Select **Use a different email** to return to an empty address form and start again; this action is disabled while requesting or verifying a code. If the address is already connected to your account, you see **This email is already connected to your account.** rather than a new address being added. Verifying may first ask you to authorize changes to your profile. When you return, LFX may show one of these notices: **Already connected** if the email is already part of your account; **Email already linked** if the code was correct but the address is linked to an LFX account (contact support if you need help — a new code won't change this); or **Email not verified** if verification did not finish — in that case start email verification again and select **Send Code** to request a new code. If authorization completes and a new address is linked successfully, you return without a separate email-verification notice.

### Password

_Keep your account secure by using a strong password and enabling two-factor authentication._

- **Change Password** — fill in **Current Password**, **New Password**, and **Confirm New Password**, then select **Change Password**. Your new password must be **at least 8 characters** and contain at least 3 of these 4: a **Lowercase letter (a-z)**, an **Uppercase letter (A-Z)**, a **Number (0-9)**, or a **Special character (!@#$%^&\*)**. A strength meter under **New Password** checks each one as you type. **Reset** clears the form. If you don't know your current password, select **Forgot your password? Start the account recovery process.** under the **Current Password** field.
- **Account Recovery** — select **Send Reset Link** to email yourself a password reset link.
- **Two-Factor Authentication** — currently shows "Two-factor authentication settings are currently unavailable." The **Set up 2FA** button is disabled.

### Developer Settings

_Your API token provides programmatic access to LFX services._

The **API Token** card shows your **Personal Access Token**. Use **Show** to reveal it and **Copy** to copy it to your clipboard (the button briefly reads **Copied!**). If no token can be loaded, the card says "API token is currently unavailable."

The **Security Guidelines** box beside it explains how to handle the token:

- This token is short-lived and automatically regenerated by the system.
- Never share it publicly. Keep this token secure.
- Never commit this token to version control.

## Save changes

Settings are NOT auto-saved. Each section has its own action button: **Send Code** / **Verify** for a new email, the **⋮** menu actions for an existing email, **Change Password** or **Send Reset Link** for your password, and **Show** / **Copy** for the API token.

## Related

- [Account overview](../) — all account areas and navigation
- [Edit your profile](../../profile/edit-profile/) — name, photo, About Me, primary email, and location
- [Account FAQ](../faq/) — common questions about settings, transactions, and CLAs
