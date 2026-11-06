// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_GUEST_INVITE_PATH, NEWSLETTER_INVITE_TOKEN_FRAGMENT_KEY } from '@lfx-one/shared/constants';
import { NewsletterGuestConfirmEmailContext, NewsletterInviteEmailContext, RenderedEmail } from '@lfx-one/shared/interfaces';
import { escapeHtml } from '@lfx-one/shared/utils/html-utils';

import { MicroserviceError } from '../errors';

/** The app origin for emailed links; never guessed — a wrong origin would mail out dead links. */
export function requireAppBaseUrl(): string {
  const baseUrl = process.env['PCC_BASE_URL'];
  if (!baseUrl) {
    throw new MicroserviceError('PCC_BASE_URL is not configured; cannot build newsletter links', 503, 'APP_BASE_URL_NOT_CONFIGURED', {
      operation: 'build_newsletter_link',
      service: 'newsletter_invite',
      clientMessage: 'Newsletter emails are temporarily unavailable. Please try again later.',
    });
  }
  return baseUrl;
}

/**
 * Link of a newsletter invite or subscription confirmation (#5235): the signed-out guest landing with
 * the signed token in the URL fragment, so it never reaches server or proxy logs. Opening it proves
 * the holder reads that inbox; a signed-in visitor is sent on to the drill-down confirm card instead.
 */
export function buildNewsletterInviteAcceptUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${NEWSLETTER_GUEST_INVITE_PATH}#${NEWSLETTER_INVITE_TOKEN_FRAGMENT_KEY}=${encodeURIComponent(token)}`;
}

/**
 * The shared LFX transactional email layout (logo header, blue button, "The LFX Team" sign-off, Linux
 * Foundation footer) used by invite-, committee-, project- and member-service templates, e.g.
 * lfx-v2-invite-service `invite_body.gohtml`. `bodyHtml` must already be escaped.
 */
function renderLfxEmailLayout(subject: string, bodyHtml: string, now: Date): string {
  const year = now.getUTCFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(subject)}</title>
    <style>
        body { margin: 0; padding: 0; background-color: #ffffff; font-family: Inter, Arial, sans-serif; color: #111827; }
        .wrapper { max-width: 600px; margin: 0 auto; padding: 32px 40px; }
        .logo { margin-bottom: 24px; }
        .logo img { height: 32px; width: auto; display: block; }
        hr { border: none; border-top: 1px solid #e5e7eb; margin: 0 0 32px 0; }
        p { font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 16px 0; }
        .greeting { font-size: 15px; color: #374151; margin: 0 0 8px 0; }
        .btn { display: inline-block; background-color: #009AFF; color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 600; padding: 12px 24px; border-radius: 8px; margin-bottom: 12px; }
        .btn-note { font-size: 13px; color: #6b7280; margin: 0 0 28px 0; }
        .btn-note a { color: #009AFF; text-decoration: none; }
        .signoff { font-size: 15px; color: #374151; margin: 0 0 32px 0; line-height: 1.7; }
        .footer-hr { border: none; border-top: 1px solid #e5e7eb; margin: 0 0 24px 0; }
        .footer { font-size: 12px; color: #9ca3af; line-height: 1.6; margin: 0; }
        .footer a { color: #9ca3af; }
        @media only screen and (max-width: 620px) {
            .wrapper { padding: 24px 20px; }
        }
    </style>
</head>
<body>
<div class="wrapper">

    <div class="logo">
        <img src="https://itx-project-logos-png-prod.s3.us-west-2.amazonaws.com/lfx-logo-color.png" alt="LFX" width="120" height="32">
    </div>
    <hr>

    <p class="greeting">Hi there,</p>

${bodyHtml}

    <p class="signoff">Thanks,<br><strong>The LFX Team</strong></p>

    <hr class="footer-hr">
    <p class="footer">Copyright © ${year} The Linux Foundation ®. All rights reserved. The Linux Foundation has registered trademarks and uses trademarks. For a list of trademarks of The Linux Foundation, please see our <a href="https://www.linuxfoundation.org/trademark-usage">Trademark Usage</a> page. Linux is a registered trademark of Linus Torvalds.</p>

</div>
</body>
</html>`;
}

/** A blue call-to-action button with the paste-this-link fallback under it. `url` must already be escaped. */
function renderEmailButton(label: string, url: string): string {
  return `    <a href="${url}" class="btn" style="color:#ffffff!important;">${label}</a>
    <p class="btn-note">If the button above doesn't work, paste this into your browser: <a href="${url}">${url}</a></p>`;
}

/**
 * The member-benefit invite email. Every interpolated value is escaped — inviter, company and
 * foundation names come from user and upstream data.
 */
export function renderNewsletterInviteEmail(context: NewsletterInviteEmailContext, now: Date = new Date()): RenderedEmail {
  const inviter = escapeHtml(context.inviter_name);
  const company = escapeHtml(context.company_name);
  const foundation = escapeHtml(context.foundation_name);
  const acceptUrl = escapeHtml(context.accept_url);

  // The inviter's name stays out of the subject: it is free profile text, and the subject is the
  // most trusted-looking line of an LFX-branded email.
  const subject = `You're invited to the ${context.foundation_name} newsletter`;

  const body = `    <p><strong>${inviter}</strong> has invited you to receive the <strong>${foundation}</strong> newsletter. Get everything you need to know about open source every week, and everything that is going on across the Linux Foundation.</p>
    <p>It&#39;s a benefit of <strong>${company}</strong>&#39;s Linux Foundation membership, so there&#39;s no cost to you.</p>
    <p>No account is needed: accept the invitation to read the latest issue, and new issues will arrive at this address. If you already have an LFID (Linux Foundation ID), you can sign in instead.</p>

${renderEmailButton('Accept invitation', acceptUrl)}

    <p>This invitation link works for 30 days. You can also invite coworkers from Newsletters in LFX once you&#39;ve signed in.</p>`;

  const text = [
    'Hi there,',
    '',
    `${context.inviter_name} has invited you to receive the ${context.foundation_name} newsletter. Get everything you need to know about open source every week, and everything that is going on across the Linux Foundation.`,
    '',
    `It's a benefit of ${context.company_name}'s Linux Foundation membership, so there's no cost to you.`,
    '',
    'No account is needed: accept the invitation to read the latest issue, and new issues will arrive at this address. If you already have an LFID (Linux Foundation ID), you can sign in instead.',
    '',
    `Accept invitation: ${context.accept_url}`,
    '',
    "This invitation link works for 30 days. You can also invite coworkers from Newsletters in LFX once you've signed in.",
    '',
    'Thanks,',
    'The LFX Team',
  ].join('\n');

  return { subject, html: renderLfxEmailLayout(subject, body, now), text };
}

/**
 * The subscription confirmation a signed-out reader gets after reading a shared newsletter link with
 * their work email (#5235). Typing an address only lets them read; opening this link proves they own
 * it and adds it to the newsletter list. Every interpolated value is escaped.
 */
export function renderNewsletterGuestConfirmEmail(context: NewsletterGuestConfirmEmailContext, now: Date = new Date()): RenderedEmail {
  const company = escapeHtml(context.company_name);
  const foundation = escapeHtml(context.foundation_name);
  const confirmUrl = escapeHtml(context.confirm_url);
  const subject = `Confirm your ${context.foundation_name} newsletter subscription`;

  const body = `    <p>You just read the <strong>${foundation}</strong> newsletter on LFX. It&#39;s a benefit of <strong>${company}</strong>&#39;s membership, so there&#39;s no cost to you.</p>
    <p>Confirm this email address to get new issues delivered to your inbox. No account is needed.</p>

${renderEmailButton('Confirm subscription', confirmUrl)}

    <p>This link works for 30 days. If you didn&#39;t ask for this, you can ignore this email and you won&#39;t be subscribed.</p>`;

  const text = [
    'Hi there,',
    '',
    `You just read the ${context.foundation_name} newsletter on LFX. It's a benefit of ${context.company_name}'s membership, so there's no cost to you.`,
    '',
    'Confirm this email address to get new issues delivered to your inbox. No account is needed.',
    '',
    `Confirm subscription: ${context.confirm_url}`,
    '',
    "This link works for 30 days. If you didn't ask for this, you can ignore this email and you won't be subscribed.",
    '',
    'Thanks,',
    'The LFX Team',
  ].join('\n');

  return { subject, html: renderLfxEmailLayout(subject, body, now), text };
}
