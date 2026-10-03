// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for `coerceCampaignEventDetails`, the one conversion both producers of a
// `CampaignEventDetails` now delegate to: the Angular planning tab normalising an SSE `event`
// frame, and the Express service reading a saved brief back out of the database.
//
// Why the field coverage below is exhaustive rather than representative: the two hand-written
// copies this function replaced had DRIFTED. The server's copy listed fewer fields than the
// interface declares and silently dropped `heroImageUrl` and `sponsors`. Both are OPTIONAL on
// `CampaignEventDetails`, so omitting them compiled cleanly, and a campaign dispatched from a
// RELOADED brief went out with no hero image and no sponsor logos with nothing failing anywhere —
// indistinguishable from a hero that failed to upload. A spec asserting a representative subset of
// fields would have passed against the broken copy, so it would not be a regression test at all;
// hence the whole-key-set assertion, the per-field round-trip, and the two extra tests naming
// `heroImageUrl` and `sponsors` on their own.
//
// Every fixture value is synthetic (RFC 2606 reserved domains).

import { describe, expect, it } from 'vitest';

import { CampaignEventDetails } from '../interfaces/campaign.interface';
import { coerceCampaignEventDetails } from './campaign-event-details.utils';

/**
 * What the conversion owes a caller that handed it nothing usable: every declared key present,
 * empty string for an absent scalar, empty array for an absent list. Empty string and not a dash
 * because this object is persisted and fed to email copy generation.
 *
 * Hand-written against `campaign.interface.ts`, never derived from the implementation — it has to
 * be able to disagree with the implementation for the key-set assertions to mean anything. The
 * `CampaignEventDetails` annotation makes the compiler police it in both directions: a missing
 * required key is an error, and excess property checking rejects a key the interface does not
 * declare, including a rename of either optional one.
 */
const EMPTY_DETAILS: CampaignEventDetails = {
  name: '',
  dates: '',
  city: '',
  countryCode: '',
  audience: '',
  themes: [],
  registrationUrl: '',
  speakers: [],
  slug: '',
  formatNotes: '',
  description: '',
  agendaUrl: '',
  cfpUrl: '',
  venueUrl: '',
  sponsorshipUrl: '',
  heroImageUrl: '',
  sponsors: [],
};

/** A saved brief with every declared field populated, each with a distinguishable value. */
const POPULATED_DETAILS: CampaignEventDetails = {
  name: 'TestOrbit Summit 2026',
  dates: 'March 3-5, 2026',
  city: 'Lisbon',
  countryCode: 'PT',
  audience: 'Platform engineers and SREs',
  themes: ['Observability', 'Developer experience'],
  registrationUrl: 'https://summit.example.com/register',
  speakers: ['Ada Example', 'Grace Sample'],
  slug: 'testorbit-summit-2026',
  formatNotes: 'Hybrid: two in-person tracks plus a streamed keynote',
  description: 'A three-day conference about operating platforms at scale.',
  agendaUrl: 'https://summit.example.com/agenda',
  cfpUrl: 'https://summit.example.com/cfp',
  venueUrl: 'https://summit.example.com/venue',
  sponsorshipUrl: 'https://summit.example.com/sponsor',
  heroImageUrl: 'https://cdn.example.com/testorbit-2026/hero.png',
  sponsors: [
    { name: 'Acme Motors', logoUrl: 'https://cdn.example.org/logos/acme-motors.svg' },
    { name: 'Vendor Corp', logoUrl: 'https://cdn.example.org/logos/vendor-corp.svg' },
  ],
};

describe('coerceCampaignEventDetails', () => {
  // Only the fresh-scrape path validated these. A value saved through the brief API, which takes
  // arbitrary strings, was read back verbatim -- and these fields are printed as hyperlinks in a
  // sent email, which has no sandbox.
  it.each(['registrationUrl', 'agendaUrl', 'cfpUrl', 'venueUrl', 'sponsorshipUrl', 'heroImageUrl'])(
    'drops a non-http(s) %s rather than handing it to an href',
    (field) => {
      const coerced = coerceCampaignEventDetails({ [field]: 'javascript:alert(1)' });

      expect((coerced as unknown as Record<string, string>)[field]).toBe('');
    }
  );

  it('keeps an ordinary https url on every url field', () => {
    const coerced = coerceCampaignEventDetails({
      registrationUrl: 'https://events.linuxfoundation.org/register',
      agendaUrl: 'http://events.linuxfoundation.org/agenda',
    });

    expect(coerced.registrationUrl).toBe('https://events.linuxfoundation.org/register');
    expect(coerced.agendaUrl).toBe('http://events.linuxfoundation.org/agenda');
  });

  // The drift pin. Compares the emitted key set against the hand-written reference above, so
  // dropping a field from the conversion fails here even though the interface declares the two
  // that went missing as optional and the compiler stays silent about losing them.
  it('emits every field CampaignEventDetails declares, so none can go missing the way heroImageUrl and sponsors did', () => {
    const result = coerceCampaignEventDetails(POPULATED_DETAILS);

    expect(Object.keys(result).sort()).toEqual(Object.keys(EMPTY_DETAILS).sort());
  });

  it('round-trips every populated field', () => {
    const result = coerceCampaignEventDetails(POPULATED_DETAILS);

    expect(result.name).toBe(POPULATED_DETAILS.name);
    expect(result.dates).toBe(POPULATED_DETAILS.dates);
    expect(result.city).toBe(POPULATED_DETAILS.city);
    expect(result.countryCode).toBe(POPULATED_DETAILS.countryCode);
    expect(result.audience).toBe(POPULATED_DETAILS.audience);
    expect(result.themes).toEqual(POPULATED_DETAILS.themes);
    expect(result.registrationUrl).toBe(POPULATED_DETAILS.registrationUrl);
    expect(result.speakers).toEqual(POPULATED_DETAILS.speakers);
    expect(result.slug).toBe(POPULATED_DETAILS.slug);
    expect(result.formatNotes).toBe(POPULATED_DETAILS.formatNotes);
    expect(result.description).toBe(POPULATED_DETAILS.description);
    expect(result.agendaUrl).toBe(POPULATED_DETAILS.agendaUrl);
    expect(result.cfpUrl).toBe(POPULATED_DETAILS.cfpUrl);
    expect(result.venueUrl).toBe(POPULATED_DETAILS.venueUrl);
    expect(result.sponsorshipUrl).toBe(POPULATED_DETAILS.sponsorshipUrl);
    expect(result.heroImageUrl).toBe(POPULATED_DETAILS.heroImageUrl);
    expect(result.sponsors).toEqual(POPULATED_DETAILS.sponsors);
  });

  it('keeps heroImageUrl, the field whose loss sent a brief-reloaded email with no hero image', () => {
    const result = coerceCampaignEventDetails({ heroImageUrl: 'https://cdn.example.com/testorbit-2026/hero.png' });

    expect(result.heroImageUrl).toBe('https://cdn.example.com/testorbit-2026/hero.png');
  });

  it('keeps sponsors, the field whose loss sent a brief-reloaded email with no sponsor logos', () => {
    const result = coerceCampaignEventDetails({ sponsors: [{ name: 'Acme Motors', logoUrl: 'https://cdn.example.org/logos/acme-motors.svg' }] });

    expect(result.sponsors).toEqual([{ name: 'Acme Motors', logoUrl: 'https://cdn.example.org/logos/acme-motors.svg' }]);
  });

  it('passes a scalar through verbatim rather than trimming it', () => {
    const result = coerceCampaignEventDetails({ name: '  TestOrbit Summit 2026  ', city: '\tLisbon\n' });

    expect(result.name).toBe('  TestOrbit Summit 2026  ');
    expect(result.city).toBe('\tLisbon\n');
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['an object', { url: 'https://cdn.example.com/testorbit-2026/hero.png' }],
    ['an array', ['https://cdn.example.com/testorbit-2026/hero.png']],
  ])('replaces a scalar field holding %s with an empty string rather than stringifying it', (_label, value) => {
    const result = coerceCampaignEventDetails({ dates: value, heroImageUrl: value });

    expect(result.dates).toBe('');
    expect(result.heroImageUrl).toBe('');
  });

  it('keeps only the string entries of a list field', () => {
    const result = coerceCampaignEventDetails({
      themes: ['Observability', 42, null, { name: 'Developer experience' }, 'Platform engineering'],
      speakers: ['Ada Example', undefined, ['Grace Sample'], 'Grace Sample'],
    });

    expect(result.themes).toEqual(['Observability', 'Platform engineering']);
    expect(result.speakers).toEqual(['Ada Example', 'Grace Sample']);
  });

  // The list filter tests type and nothing else, so an empty string survives. Pinned because
  // adding a truthiness check here is a plausible tidy-up, and it would change persisted output.
  it('keeps an empty string inside a list field', () => {
    const result = coerceCampaignEventDetails({ themes: ['', 'Observability'] });

    expect(result.themes).toEqual(['', 'Observability']);
  });

  it('yields an empty list for a list field that is not an array', () => {
    const result = coerceCampaignEventDetails({ themes: 'Observability, Developer experience', speakers: null });

    expect(result.themes).toEqual([]);
    expect(result.speakers).toEqual([]);
  });

  it('drops keys CampaignEventDetails does not declare', () => {
    const result = coerceCampaignEventDetails({ ...POPULATED_DETAILS, tier: 'platinum', scrapedAt: '2026-03-01T00:00:00Z' });

    expect(Object.keys(result).sort()).toEqual(Object.keys(EMPTY_DETAILS).sort());
    expect('tier' in result).toBe(false);
    expect('scrapedAt' in result).toBe(false);
  });

  // The output is persisted and re-read, so the conversion must not hand back the caller's own
  // containers: an edit that returned `raw['themes']` or the input sponsor objects directly would
  // let a mutation of the normalised copy reach the blob it was normalised from.
  it('returns its own object and arrays rather than aliasing the input', () => {
    const result = coerceCampaignEventDetails(POPULATED_DETAILS);

    expect(result).not.toBe(POPULATED_DETAILS);
    expect(result.themes).not.toBe(POPULATED_DETAILS.themes);
    expect(result.speakers).not.toBe(POPULATED_DETAILS.speakers);
    expect(result.sponsors).not.toBe(POPULATED_DETAILS.sponsors);
    expect(result.sponsors?.[0]).not.toBe(POPULATED_DETAILS.sponsors?.[0]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'TestOrbit Summit 2026'],
    ['a number', 2026],
    ['a boolean', true],
    // An array clears the `typeof value === 'object' && value !== null` guard, so it is read as a
    // bag of keys rather than rejected outright. None of the declared keys are present on it, so
    // the result is still the all-empty shape.
    ['an array', ['Observability', 'Developer experience']],
  ])('yields the all-empty shape, rather than throwing, when handed %s', (_label, value) => {
    expect(coerceCampaignEventDetails(value)).toEqual(EMPTY_DETAILS);
  });

  it('yields the all-empty shape for an object carrying none of the declared keys', () => {
    expect(coerceCampaignEventDetails({})).toEqual(EMPTY_DETAILS);
  });

  describe('sponsors', () => {
    // The two halves of the sponsor rule, which exists because the only consumer is a logo wall
    // (the brief preview, and the dispatched email's sponsor tier): no logo means an empty cell
    // that reads as broken layout, while a missing name is just logo markup with no `alt` text.
    it('drops a sponsor that has no logoUrl', () => {
      const result = coerceCampaignEventDetails({
        sponsors: [{ name: 'Acme Motors' }, { name: 'Vendor Corp', logoUrl: 'https://cdn.example.org/logos/vendor-corp.svg' }],
      });

      expect(result.sponsors).toEqual([{ name: 'Vendor Corp', logoUrl: 'https://cdn.example.org/logos/vendor-corp.svg' }]);
    });

    it('keeps a sponsor whose name is empty, because logo alt text is routinely absent', () => {
      const result = coerceCampaignEventDetails({ sponsors: [{ name: '', logoUrl: 'https://cdn.example.org/logos/acme-motors.svg' }] });

      expect(result.sponsors).toEqual([{ name: '', logoUrl: 'https://cdn.example.org/logos/acme-motors.svg' }]);
    });

    it('drops a sponsor whose logoUrl is an empty string', () => {
      const result = coerceCampaignEventDetails({ sponsors: [{ name: 'Acme Motors', logoUrl: '' }] });

      expect(result.sponsors).toEqual([]);
    });

    it('drops a sponsor whose logoUrl is present but not a string', () => {
      const result = coerceCampaignEventDetails({
        sponsors: [{ name: 'Acme Motors', logoUrl: { href: 'https://cdn.example.org/logos/acme-motors.svg' } }],
      });

      expect(result.sponsors).toEqual([]);
    });

    it('replaces a non-string sponsor name with an empty string and keeps the sponsor', () => {
      const result = coerceCampaignEventDetails({ sponsors: [{ name: 42, logoUrl: 'https://cdn.example.org/logos/acme-motors.svg' }] });

      expect(result.sponsors).toEqual([{ name: '', logoUrl: 'https://cdn.example.org/logos/acme-motors.svg' }]);
    });

    it('keeps only name and logoUrl from a sponsor entry', () => {
      const result = coerceCampaignEventDetails({
        sponsors: [{ name: 'Acme Motors', logoUrl: 'https://cdn.example.org/logos/acme-motors.svg', tier: 'platinum', width: 240 }],
      });

      expect(result.sponsors).toEqual([{ name: 'Acme Motors', logoUrl: 'https://cdn.example.org/logos/acme-motors.svg' }]);
      expect(Object.keys(result.sponsors?.[0] ?? {}).sort()).toEqual(['logoUrl', 'name']);
    });

    // `null` is the entry that makes the object guard load-bearing: reading `logoUrl` off it would
    // throw, so dropping that guard turns one bad scrape row into a failed conversion.
    it('drops a sponsor entry that is not an object, without throwing on null', () => {
      const result = coerceCampaignEventDetails({
        sponsors: ['Acme Motors', null, 42, true, [], { name: 'Vendor Corp', logoUrl: 'https://cdn.example.org/logos/vendor-corp.svg' }],
      });

      expect(result.sponsors).toEqual([{ name: 'Vendor Corp', logoUrl: 'https://cdn.example.org/logos/vendor-corp.svg' }]);
    });

    it.each([
      ['a string', 'Acme Motors'],
      ['an object keyed by sponsor name', { 'Acme Motors': 'https://cdn.example.org/logos/acme-motors.svg' }],
      ['null', null],
      ['undefined', undefined],
    ])('yields no sponsors when sponsors is %s', (_label, value) => {
      expect(coerceCampaignEventDetails({ sponsors: value }).sponsors).toEqual([]);
    });
  });
});
