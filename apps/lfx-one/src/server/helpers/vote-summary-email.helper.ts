// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { RenderedEmail, VoteSummaryEmailContext } from '@lfx-one/shared/interfaces';
import { escapeHtml } from '@lfx-one/shared/utils';

/**
 * The on-demand vote-close summary email (#3662), in the shared LFX transactional email layout
 * (logo header, "The LFX Team" sign-off, Linux Foundation footer) used by
 * `newsletter-invite-email.helper.ts` and the invite-/committee-/member-service templates.
 * Carries only aggregate results (participation counts, per-choice counts and percentages) — never
 * an individual recipient's ballot, so the same rendered body is sent to every recipient. Every
 * interpolated string is escaped — the vote title and question/choice text are free text set by the
 * vote's creator, and `percentage` is a pre-formatted string rather than a number.
 */
export function renderVoteSummaryEmail(context: VoteSummaryEmailContext, now: Date = new Date()): RenderedEmail {
  const title = escapeHtml(context.vote_title);
  const year = now.getUTCFullYear();
  const subject = `Results summary: ${context.vote_title}`;

  const questionsHtml = context.questions
    .map((question) => {
      const choiceRows = question.choices
        .map(
          (choice) =>
            `<tr><td style="padding:4px 0;color:#374151;font-size:15px;">${escapeHtml(choice.text)}</td><td style="padding:4px 0 4px 16px;color:#374151;font-size:15px;white-space:nowrap;">${choice.vote_count} (${escapeHtml(choice.percentage)})</td></tr>`
        )
        .join('');
      return `<p style="font-size:16px;color:#111827;font-weight:600;margin:0 0 8px 0;">${escapeHtml(question.prompt)}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 24px 0;">${choiceRows}</table>`;
    })
    .join('');

  const questionsText = context.questions
    .map((question) => `${question.prompt}\n` + question.choices.map((choice) => `  ${choice.text}: ${choice.vote_count} (${choice.percentage})`).join('\n'))
    .join('\n\n');

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
        .stats { font-size: 15px; color: #374151; margin: 0 0 24px 0; line-height: 1.7; }
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

    <p>The vote <strong>${title}</strong> has closed. Here is a summary of the results.</p>

    <p class="stats">${context.num_votes_cast} of ${context.num_recipients} invited voters responded (${context.num_abstained} abstained).</p>

    ${questionsHtml}

    <p class="signoff">Thanks,<br><strong>The LFX Team</strong></p>

    <hr class="footer-hr">
    <p class="footer">Copyright © ${year} The Linux Foundation ®. All rights reserved. The Linux Foundation has registered trademarks and uses trademarks. For a list of trademarks of The Linux Foundation, please see our <a href="https://www.linuxfoundation.org/trademark-usage">Trademark Usage</a> page. Linux is a registered trademark of Linus Torvalds.</p>

</div>
</body>
</html>`;

  const text = [
    'Hi there,',
    '',
    `The vote "${context.vote_title}" has closed. Here is a summary of the results.`,
    '',
    `${context.num_votes_cast} of ${context.num_recipients} invited voters responded (${context.num_abstained} abstained).`,
    '',
    questionsText,
    '',
    'Thanks,',
    'The LFX Team',
  ].join('\n');

  return { subject, html, text };
}
