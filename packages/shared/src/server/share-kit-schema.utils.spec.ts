// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { validateShareKitContent } from './share-kit-schema.utils';

function validKit(): Record<string, unknown> {
  return {
    eventSlug: 'example-summit-2027',
    foundationSlug: 'example-foundation',
    foundationName: 'Example Foundation',
    title: 'Example Summit',
    tagline: 'A conference for people building example software.',
    startDate: '2027-04-28',
    endDate: '2027-04-29',
    venue: 'Example Hall',
    city: 'Example City',
    eventUrl: 'https://events.example.org/summit/',
    registration: { url: 'https://events.example.org/summit/register/', priceLabel: '$399', earlyBirdUntil: '2027-02-28' },
    posts: [{ id: 'invite', title: 'Invite your network', text: { linkedin: 'Join us.', x: 'Join us.', bluesky: 'Join us.' } }],
    newsletterBlurb: { text: 'Example Summit takes place in April.', url: 'https://events.example.org/summit/' },
    graphics: [{ label: 'Promo', url: '/share-kits/example-summit-2027/promo.png', alt: 'Example Summit promo', width: 800, height: 418 }],
    cfp: { url: 'https://events.example.org/summit/cfp/', closesOn: '2027-01-18', heading: 'Speak', body: 'Submit a talk.', invitation: 'Submit a talk.' },
  };
}

describe('validateShareKitContent', () => {
  it('accepts a complete, valid kit and returns the parsed content', () => {
    const result = validateShareKitContent(validKit(), 'example-summit-2027');
    expect(result.ok).toBe(true);
    expect(result.content?.posts[0].id).toBe('invite');
    expect(result.problems).toEqual([]);
  });

  it('rejects HTML in a text field', () => {
    const kit = validKit();
    kit['tagline'] = 'Come <script>alert(1)</script> along';
    const result = validateShareKitContent(kit);
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('tagline: must be plain text');
  });

  it('rejects links that are not https', () => {
    const kit = validKit();
    kit['eventUrl'] = 'http://events.example.org/summit/';
    expect(validateShareKitContent(kit).problems.join('\n')).toContain('eventUrl: must start with https://');
  });

  it('rejects an image path outside /share-kits/', () => {
    const kit = validKit();
    kit['graphics'] = [{ label: 'Promo', url: '/images/promo.png', alt: 'Promo', width: 800, height: 418 }];
    expect(validateShareKitContent(kit).ok).toBe(false);
  });

  it('rejects unknown keys, such as a member code, instead of ignoring them', () => {
    const kit = validKit();
    kit['memberOffer'] = { code: 'SECRET', discountLabel: '20% off' };
    const result = validateShareKitContent(kit);
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).not.toContain('SECRET');
  });

  it.each(['2027-02-29', '2027-02-30', '2027-04-31', '2027-13-01'])('rejects the impossible date %s', (day) => {
    const kit = validKit();
    kit['startDate'] = day;
    expect(validateShareKitContent(kit).problems.join('\n')).toContain('startDate: must be a real date');
  });

  it('accepts a public member benefit, which carries no code', () => {
    const kit = validKit();
    kit['memberBenefit'] = { membershipSlug: 'example-foundation', membershipName: 'Example', discountLabel: '20% off', joinUrl: 'https://example.org/join' };
    expect(validateShareKitContent(kit).ok).toBe(true);
  });

  it('rejects a code placed inside the member benefit', () => {
    const kit = validKit();
    kit['memberBenefit'] = {
      membershipSlug: 'example-foundation',
      membershipName: 'Example',
      discountLabel: '20% off',
      joinUrl: 'https://example.org/join',
      code: 'SECRET',
    };
    expect(validateShareKitContent(kit).ok).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    const kit = validKit();
    kit['endDate'] = '2027-04-27';
    expect(validateShareKitContent(kit).problems.join('\n')).toContain('endDate must not be before startDate');
  });

  it('rejects duplicate post ids', () => {
    const kit = validKit();
    const post = (kit['posts'] as unknown[])[0];
    kit['posts'] = [post, post];
    expect(validateShareKitContent(kit).problems.join('\n')).toContain('post ids must be unique');
  });

  it('accepts posts that exactly fill X and Bluesky once the link is added', () => {
    const kit = validKit();
    kit['posts'] = [{ id: 'invite', title: 'Invite', text: { linkedin: 'Hi', x: 'a'.repeat(255), bluesky: 'a'.repeat(258) } }];
    expect(validateShareKitContent(kit).ok).toBe(true);
  });

  it('rejects an X post too long to fit with its link', () => {
    const kit = validKit();
    kit['posts'] = [{ id: 'invite', title: 'Invite', text: { linkedin: 'Hi', x: 'a'.repeat(256), bluesky: 'Hi' } }];
    expect(validateShareKitContent(kit).problems.join('\n')).toContain('281 of 280 characters');
  });

  it('uses X weighting, so CJK text counts twice', () => {
    const kit = validKit();
    kit['posts'] = [{ id: 'invite', title: 'Invite', text: { linkedin: 'Hi', x: '漢'.repeat(130), bluesky: 'Hi' } }];
    expect(validateShareKitContent(kit).problems.join('\n')).toContain('285 of 280 characters');
  });

  it('rejects a Bluesky post too long to fit with its link', () => {
    const kit = validKit();
    kit['posts'] = [{ id: 'invite', title: 'Invite', text: { linkedin: 'Hi', x: 'Hi', bluesky: 'a'.repeat(259) } }];
    expect(validateShareKitContent(kit).problems.join('\n')).toContain('301 of 300 characters');
  });

  describe('theme', () => {
    const theme = () => ({
      colors: {
        hero: '#3731C9',
        heroText: '#FFFFFF',
        soft: '#B6B0D0',
        accent: '#FF702D',
        button: '#FF702D',
        buttonText: '#0B0A1E',
        primary: '#3731C9',
        page: '#F6F6FB',
      },
      logo: { url: '/share-kits/example-summit-2027/logo.svg', alt: 'Example Summit', width: 544, height: 122 },
      headline: 'Where builders meet',
      headingFont: 'inter-tight',
    });

    it('accepts an event theme', () => {
      const kit = validKit();
      kit['theme'] = theme();
      expect(validateShareKitContent(kit).problems).toEqual([]);
    });

    it('rejects text colours below WCAG AA against their background, naming the pair', () => {
      const kit = validKit();
      const bad = theme();
      bad.colors.heroText = '#B6B0D0';
      kit['theme'] = bad;
      expect(validateShareKitContent(kit).problems.join('\n')).toContain('theme.colors.hero: heroText on hero has contrast 4.13:1');
    });

    it('rejects colours that are not #RRGGBB, fonts outside the allowlist and markup in the headline', () => {
      const kit = validKit();
      kit['theme'] = { ...theme(), colors: { ...theme().colors, accent: 'orange' }, headingFont: 'comic-sans', headline: '<b>Hi</b>' };
      const problems = validateShareKitContent(kit).problems.join('\n');
      expect(problems).toContain('theme.colors.accent: must be a #RRGGBB colour');
      expect(problems).toContain('theme.headingFont');
      expect(problems).toContain('theme.headline: must be plain text');
    });
  });

  it('requires eventSlug to match its folder name', () => {
    const result = validateShareKitContent(validKit(), 'other-event');
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('must match its folder name');
  });
});
