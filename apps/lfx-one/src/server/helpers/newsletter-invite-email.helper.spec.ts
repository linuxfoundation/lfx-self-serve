// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildNewsletterInviteAcceptUrl, renderNewsletterInviteEmail } from './newsletter-invite-email.helper';

describe('newsletter invite email', () => {
  it('links through /login to the foundation drill-down with the group as the invite param', () => {
    expect(buildNewsletterInviteAcceptUrl('https://app.lfx.example/', 'acme-foundation', 'c-news')).toBe(
      `https://app.lfx.example/login?returnTo=${encodeURIComponent('/newsletters/my/acme-foundation?invite=c-news')}`
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
      expect(part).toContain('create an LFX account and confirm your company email address');
      expect(part).toContain('forward this invite to your coworkers');
    }
    expect(email.text).toContain('Accept invitation: https://app.lfx.example/login');
    expect(email.html).toContain('The LFX Team');
  });
});
