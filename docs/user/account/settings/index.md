---
title: Settings
description: Manage your email addresses, password, two-factor authentication, and developer API token in LFX Self Serve.
audience: [all]
product_area: Account
tags: [account, settings, email, password, developer, api-token, security, meeting-invitations]
last_updated: 2026-10-25
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

The Settings tab (`/profile/settings`) has three sections on one page:

- **Email Settings** — add a new email address using the **Add New Email Address** button, then confirm with the **Send Code** button. A 6-digit verification code is sent to the new address; enter it to finish. If the address is already connected to your account, you see **This email is already connected to your account.** rather than a new address being added. Verifying may first ask you to authorize changes to your profile; when you return to Settings, LFX tells you if the email is already connected or if verification did not finish — in that case enter the code again, or select **Send Code** for a new one if the previous code expired or was already used. To choose which verified address is primary, use the [Edit Profile drawer](../../profile/edit-profile/#primary-email-address). The **Meeting Invites** badge marks the address that receives meeting invitations — your primary address until you choose another. Use **Use for Meeting Invitations** in any other verified address's actions menu to switch. Meeting invitations stay on that address when you change your primary email; choose a new one here to move them. An address selected for meeting invitations can't be deleted until you choose a different one.
- **Password** — change your password using the **Current Password**, **New Password**, and **Confirm New Password** fields, then select **Change Password**. Use **Send Reset Link** if you have forgotten your current password. An **Account Recovery** section is also available. Two-factor authentication currently shows "Two-factor authentication settings are currently unavailable" with a **Set up 2FA** button.
- **Developer Settings** — view your **Personal Access Token**. Use the **Show** button to reveal it and the **Copy** button to copy it to your clipboard. Never share this token publicly.

## Save changes

Settings are NOT auto-saved. Each section has its own action button: **Add New Email Address** / **Send Code** for email, **Change Password** for password, and **Show** / **Copy** for the API token.

## Related

- [Account overview](../) — all account areas and navigation
- [Edit your profile](../../profile/edit-profile/) — name, photo, About Me, primary email, and location
- [Account FAQ](../faq/) — common questions about settings, transactions, and CLAs
