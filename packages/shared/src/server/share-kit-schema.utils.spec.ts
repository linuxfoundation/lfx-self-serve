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

  it('rejects an X post too long to fit with its link', () => {
    const kit = validKit();
    kit['posts'] = [{ id: 'invite', title: 'Invite', text: { linkedin: 'Hi', x: 'a'.repeat(241), bluesky: 'Hi' } }];
    expect(validateShareKitContent(kit).ok).toBe(false);
  });

  it('requires eventSlug to match its folder name', () => {
    const result = validateShareKitContent(validKit(), 'other-event');
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('must match its folder name');
  });
});
