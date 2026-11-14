// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildNewsletterInviteAcceptUrl, renderNewsletterGuestConfirmEmail, renderNewsletterInviteEmail } from './newsletter-invite-email.helper';

describe('newsletter invite email', () => {
  it('links to the guest landing with the signed token in the URL fragment', () => {
    expect(buildNewsletterInviteAcceptUrl('https://app.lfx.example/', 'abc.def+/=')).toBe(
      `https://app.lfx.example/newsletters/invite#token=${encodeURIComponent('abc.def+/=')}`
    );
  });

  it('escapes every interpolated value in the HTML body', () => {
    const email = renderNewsletterInviteEmail(
      {
        inviter_name: '<script>alert(1)</script>',
        company_name: 'Acme & Sons',
        foundation_name: 'Acme "Foundation"',
        accept_url: 'https://app.lfx.example/login?returnTo=%2Fx&y=1',
      },
      new Date('2026-10-12T00:00:00Z')
    );

    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('Acme &amp; Sons');
    expect(email.html).toContain('href="https://app.lfx.example/login?returnTo=%2Fx&amp;y=1"');
    expect(email.html).toContain('Copyright © 2026 The Linux Foundation');
  });

  it('carries the member-benefit copy in both the HTML and text parts', () => {
    const email = renderNewsletterInviteEmail({
      inviter_name: 'Jane Doe',
      company_name: 'Acme Motors',
      foundation_name: 'Acme Foundation',
      accept_url: 'https://app.lfx.example/login',
    });

    expect(email.subject).toBe("You're invited to the Acme Foundation newsletter");
    expect(email.subject).not.toContain('Jane Doe');
    for (const part of [email.html, email.text]) {
      expect(part).toContain('Get everything you need to know about open source every week');
      expect(part).toContain('No account is needed');
      expect(part).toContain('This invitation link works for 30 days');
    }
    expect(email.text).toContain('Accept invitation: https://app.lfx.example/login');
    expect(email.html).toContain('The LFX Team');
  });

  it('renders the shared-link subscription confirmation, escaped, in both parts', () => {
    const email = renderNewsletterGuestConfirmEmail(
      { company_name: 'Acme & Sons', foundation_name: 'Acme Foundation', confirm_url: 'https://app.lfx.example/newsletters/invite#token=a&b' },
      new Date('2026-11-05T00:00:00Z')
    );

    expect(email.subject).toBe('Confirm your Acme Foundation newsletter subscription');
    expect(email.html).toContain('Acme &amp; Sons');
    expect(email.html).toContain('href="https://app.lfx.example/newsletters/invite#token=a&amp;b"');
    for (const part of [email.html, email.text]) {
      expect(part).toContain('Confirm this email address to get new issues delivered to your inbox');
      expect(part).toContain('you won');
    }
    expect(email.text).toContain('Confirm subscription: https://app.lfx.example/newsletters/invite#token=a&b');
  });
});
