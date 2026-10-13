// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_INVITE_QUERY_PARAM } from '@lfx-one/shared/constants';
import { NewsletterInviteEmailContext, RenderedEmail } from '@lfx-one/shared/interfaces';
import { escapeHtml } from '@lfx-one/shared/utils/html-utils';

/**
 * Accept link of a newsletter invite: `/login?returnTo=<drill-down>` so a signed-out invitee goes
 * through Auth0 (sign in or sign up) and lands on the foundation drill-down, which re-checks
 * eligibility for whoever signs in. The link carries no credential — only the group uid as a hint.
 */
export function buildNewsletterInviteAcceptUrl(baseUrl: string, foundationSlug: string, committeeUid: string): string {
  const landing = `/newsletters/my/${encodeURIComponent(foundationSlug)}?${NEWSLETTER_INVITE_QUERY_PARAM}=${encodeURIComponent(committeeUid)}`;
  return `${baseUrl.replace(/\/+$/, '')}/login?returnTo=${encodeURIComponent(landing)}`;
}

/**
 * The member-benefit invite email, in the shared LFX transactional email layout (logo header, blue
 * button, "The LFX Team" sign-off, Linux Foundation footer) used by invite-, committee-, project-
 * and member-service templates, e.g. lfx-v2-invite-service `invite_body.gohtml`. Every interpolated
 * value is escaped — inviter, company and foundation names come from user and upstream data.
 */
export function renderNewsletterInviteEmail(context: NewsletterInviteEmailContext, now: Date = new Date()): RenderedEmail {
  const inviter = escapeHtml(context.inviter_name);
  const company = escapeHtml(context.company_name);
  const foundation = escapeHtml(context.foundation_name);
  const acceptUrl = escapeHtml(context.accept_url);
  const year = now.getUTCFullYear();

  // The inviter's name stays out of the subject: it is free profile text, and the subject is the
  // most trusted-looking line of an LFX-branded email.
  const subject = `You're invited to the ${context.foundation_name} newsletter`;

  const html = `<!DOCTYPE html>
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
        ol { font-size: 16px; color: #374151; line-height: 1.8; margin: 0 0 16px 0; padding-left: 20px; }
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

    <p><strong>${inviter}</strong> has invited you to receive the <strong>${foundation}</strong> newsletter. Get everything you need to know about open source every week, and everything that is going on across the Linux Foundation.</p>
    <p>It&#39;s a benefit of <strong>${company}</strong>&#39;s Linux Foundation membership, so there&#39;s no cost to you.</p>
    <p>All you need to do is create an LFID (Linux Foundation ID) and confirm your company email address to be added to the list:</p>
    <ol>
        <li>Click the button below to accept the invitation</li>
        <li>Create your LFID (or sign in if you already have one)</li>
        <li>Confirm your company email address, and you&#39;ll start receiving the newsletter</li>
    </ol>

    <a href="${acceptUrl}" class="btn" style="color:#ffffff!important;">Accept invitation</a>
    <p class="btn-note">If the button above doesn't work, paste this into your browser: <a href="${acceptUrl}">${acceptUrl}</a></p>

    <p>You can also invite coworkers from My Newsletters in LFX once you&#39;ve joined.</p>

    <p class="signoff">Thanks,<br><strong>The LFX Team</strong></p>

    <hr class="footer-hr">
    <p class="footer">Copyright © ${year} The Linux Foundation ®. All rights reserved. The Linux Foundation has registered trademarks and uses trademarks. For a list of trademarks of The Linux Foundation, please see our <a href="https://www.linuxfoundation.org/trademark-usage">Trademark Usage</a> page. Linux is a registered trademark of Linus Torvalds.</p>

</div>
</body>
</html>`;

  const text = [
    'Hi there,',
    '',
    `${context.inviter_name} has invited you to receive the ${context.foundation_name} newsletter. Get everything you need to know about open source every week, and everything that is going on across the Linux Foundation.`,
    '',
    `It's a benefit of ${context.company_name}'s Linux Foundation membership, so there's no cost to you.`,
    '',
    'All you need to do is create an LFID (Linux Foundation ID) and confirm your company email address to be added to the list:',
    '1. Open the link below to accept the invitation',
    '2. Create your LFID (or sign in if you already have one)',
    "3. Confirm your company email address, and you'll start receiving the newsletter",
    '',
    `Accept invitation: ${context.accept_url}`,
    '',
    "You can also invite coworkers from My Newsletters in LFX once you've joined.",
    '',
    'Thanks,',
    'The LFX Team',
  ].join('\n');

  return { subject, html, text };
}
