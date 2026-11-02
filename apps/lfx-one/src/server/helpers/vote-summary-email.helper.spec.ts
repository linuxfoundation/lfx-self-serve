// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { renderVoteSummaryEmail } from './vote-summary-email.helper';

describe('vote summary email (#3662)', () => {
  it('escapes every interpolated value in the HTML body — vote title, prompt, and choice text are free text set by the vote creator', () => {
    const email = renderVoteSummaryEmail(
      {
        vote_title: '<img src=x onerror=alert(1)>',
        num_recipients: 10,
        num_votes_cast: 8,
        num_abstained: 2,
        questions: [
          {
            prompt: 'Approve <script>alert(1)</script> the budget?',
            choices: [{ text: 'Yes & "no"', vote_count: 5, percentage: '<b>62%</b>' }],
          },
        ],
      },
      new Date('2026-10-12T00:00:00Z')
    );

    expect(email.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).not.toContain('<b>62%</b>');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('Approve &lt;script&gt;alert(1)&lt;/script&gt; the budget?');
    expect(email.html).toContain('Yes &amp; &quot;no&quot;');
    expect(email.html).toContain('&lt;b&gt;62%&lt;/b&gt;');
    expect(email.html).toContain('Copyright © 2026 The Linux Foundation');
  });

  it('carries aggregate results only, never an individual ballot, in both HTML and text parts', () => {
    const email = renderVoteSummaryEmail({
      vote_title: 'Board decision 2026',
      num_recipients: 12,
      num_votes_cast: 9,
      num_abstained: 3,
      questions: [
        {
          prompt: 'Approve the 2026 budget?',
          choices: [
            { text: 'Yes', vote_count: 6, percentage: '67%' },
            { text: 'No', vote_count: 3, percentage: '33%' },
          ],
        },
      ],
    });

    expect(email.subject).toBe('Results summary: Board decision 2026');
    for (const part of [email.html, email.text]) {
      expect(part).toContain('9 of 12 invited voters responded (3 abstained)');
      expect(part).toContain('Approve the 2026 budget?');
      expect(part).toContain('67%');
      expect(part).toContain('33%');
    }
    expect(email.html).toContain('The LFX Team');
  });
});
