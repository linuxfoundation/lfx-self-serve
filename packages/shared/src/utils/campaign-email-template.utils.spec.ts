// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the email template picker's brand-and-edition scope. The event names and template
// names are the naming patterns the LF HubSpot portal actually uses (the picker's whole job is to
// tell a brand's templates from the other brands' in that portal), with ids made up.

import { describe, expect, it } from 'vitest';

import type { CampaignEmailTemplateScope, HubSpotMarketingEmail } from '../interfaces/campaign.interface';
import {
  classifyEmailTemplate,
  containsTemplatePhrase,
  deriveEmailTemplateScope,
  isSentEmailTemplate,
  namesEditionPlace,
  normalizeTemplateText,
  parseEventStartDate,
} from './campaign-email-template.utils';

const details = (name: string, city = '', countryCode = '', slug = '') => ({ name, city, countryCode, slug });

const row = (name: string, state = 'PUBLISHED', subject = ''): HubSpotMarketingEmail => ({ id: name, name, state, subject });

describe('normalizeTemplateText / containsTemplatePhrase', () => {
  it('matches whole words regardless of punctuation and case', () => {
    expect(normalizeTemplateText('KubeCon+CloudNativeCon NA 2026 | Last Chance')).toBe('kubecon cloudnativecon na 2026 last chance');
    expect(containsTemplatePhrase(normalizeTemplateText('KubeCon+CloudNativeCon'), 'kubecon')).toBe(true);
    expect(containsTemplatePhrase(normalizeTemplateText('KubeConference recap'), 'kubecon')).toBe(false);
    expect(containsTemplatePhrase(normalizeTemplateText('Open Source Summitry'), 'open source summit')).toBe(false);
  });
});

describe('deriveEmailTemplateScope', () => {
  it('splits a co-branded event into brand phrases and keeps the edition aside', () => {
    const scope = deriveEmailTemplateScope(details('KubeCon + CloudNativeCon North America 2026', 'Salt Lake City', 'US'));
    expect(scope).not.toBeNull();
    expect(scope?.phrases).toEqual(['kubecon', 'cloudnativecon']);
    expect(scope?.label).toBe('KubeCon + CloudNativeCon');
    expect(scope?.year).toBe('2026');
    expect(scope?.editionLabel).toBe('North America 2026');
    expect(scope?.editionTerms).toEqual(expect.arrayContaining(['north america', 'na', 'salt lake city', 'united states', 'us', 'usa']));
  });

  it('finds every brand in an event made of several (the OS Summit Japan case)', () => {
    const scope = deriveEmailTemplateScope(details('Open Source Summit Japan + AutoLinux + Embedded Linux 2026', 'Tokyo', 'JP'));
    expect(scope?.phrases).toEqual(['open source summit', 'autolinux', 'embedded linux']);
    expect(scope?.editionTerms).toEqual(expect.arrayContaining(['japan', 'tokyo']));
  });

  it('removes a city named in the event and a country even without a country code', () => {
    expect(deriveEmailTemplateScope(details('MCP Dev Summit Nairobi', 'Nairobi', 'KE'))?.phrases).toEqual(['mcp dev summit']);
    expect(deriveEmailTemplateScope(details('PyTorch Day China 2026'))?.phrases).toEqual(['pytorch day']);
    expect(deriveEmailTemplateScope(details('Open Source Summit Korea + MCP Dev Summit Seoul', 'Seoul', 'KR'))?.phrases).toEqual([
      'open source summit',
      'mcp dev summit',
    ]);
  });

  it('searches each brand word of a name written without separators, but keeps ordinary phrases whole', () => {
    // A brief read back from a slug: no "+", so both brands sit in one segment.
    const kubecon = deriveEmailTemplateScope(details('Kubecon Cloudnativecon Europe 2028'));
    expect(kubecon?.phrases).toEqual(['kubecon', 'cloudnativecon']);
    expect(kubecon?.label).toBe('Kubecon Cloudnativecon');
    expect(deriveEmailTemplateScope(details('AGNTCon MCPCon North America 2027'))?.phrases).toEqual(['agntcon', 'mcpcon']);
    expect(deriveEmailTemplateScope(details('Open Source Summit Japan'))?.phrases).toEqual(['open source summit']);
    expect(deriveEmailTemplateScope(details('Embedded Linux Conference'))?.phrases).toEqual(['embedded linux conference']);
  });

  it('treats a region abbreviation as an edition, not part of the brand', () => {
    expect(deriveEmailTemplateScope(details('KubeCon + CloudNativeCon NA 2026'))?.phrases).toEqual(['kubecon', 'cloudnativecon']);
  });

  it('drops segments that are only generic words', () => {
    expect(deriveEmailTemplateScope(details('AI_dev: Open Source GenAI & ML Summit Europe 2026'))?.phrases).toEqual([
      'ai dev',
      'open source genai',
      'ml summit',
    ]);
    expect(deriveEmailTemplateScope(details('Summit 2026'))).toBeNull();
  });

  it('falls back to the slug and returns null when nothing names a brand', () => {
    expect(deriveEmailTemplateScope(details('', '', '', 'pytorch-day-india'))?.phrases).toEqual(['pytorch day']);
    expect(deriveEmailTemplateScope(details(''))).toBeNull();
    expect(deriveEmailTemplateScope(null)).toBeNull();
  });
});

describe('classifyEmailTemplate', () => {
  const kubecon = deriveEmailTemplateScope(details('KubeCon + CloudNativeCon North America 2026', 'Salt Lake City', 'US')) as CampaignEmailTemplateScope;

  it("puts this edition's templates first and other editions after", () => {
    expect(classifyEmailTemplate(row('Last Chance to Join KubeCon + CloudNativeCon North America'), kubecon)).toBe('this-edition');
    expect(classifyEmailTemplate(row('Attendee Exclusive: Save Up to 54% on KubeCon + CloudNativeCon NA'), kubecon)).toBe('this-edition');
    expect(classifyEmailTemplate(row('Registration Is Open! KubeCon + CloudNativeCon Europe 2027'), kubecon)).toBe('other-edition');
    // The previous North America edition names the region but another year.
    expect(classifyEmailTemplate(row('KubeCon + CloudNativeCon North America 2025 | Final Countdown'), kubecon)).toBe('other-edition');
  });

  it('matches on the subject when the name does not carry the brand', () => {
    expect(classifyEmailTemplate(row('New email', 'PUBLISHED', 'Exclusive Utah Discount Inside: KubeCon + CloudNativeCon NA'), kubecon)).toBe('this-edition');
  });

  it('excludes rows that are not clone sources for a new event send', () => {
    for (const excluded of [
      row('KubeCon + CloudNativeCon North America — 46e6130a-bc46-43b4-ae65-443971cc567d', 'DRAFT'),
      row('KubeCon + CloudNativeCon North America — addfda30-c7ff-4a17-bacb-d76bb8c1966d - Variant B', 'DRAFT_AB_VARIANT'),
      row('Events - Tickets - Travel Fund - Approval - KubeCon NA 2026 Speaker', 'AUTOMATED'),
      row('test KubeCon + CloudNativeCon NA (Clone)', 'DRAFT'),
      row('KubeCon + CloudNativeCon NA 2026 promo (Clone)', 'DRAFT'),
      row('CNCF Newsletter: KubeCon + CloudNativeCon NA recap', 'PUBLISHED'),
      row('Linux Foundation November Newsletter', 'PUBLISHED'),
      row('PyTorch Day China 2026: Registration Live', 'PUBLISHED'),
    ]) {
      expect(classifyEmailTemplate(excluded, kubecon), excluded.name).toBe('excluded');
    }
    // A clone that actually went out is a real send, not someone's draft.
    expect(classifyEmailTemplate(row('REMINDER: Save Up to 54% on KubeCon + CloudNativeCon NA (Clone)', 'PUBLISHED'), kubecon)).toBe('this-edition');
  });

  it('uses the year alone when the event names no edition', () => {
    const scope = deriveEmailTemplateScope(details('Open Compliance Summit 2026')) as CampaignEmailTemplateScope;
    expect(scope.phrases).toEqual(['open compliance summit']);
    expect(classifyEmailTemplate(row('Last Chance to Request an Invitation: Open Compliance Summit 2026'), scope)).toBe('this-edition');
    expect(classifyEmailTemplate(row('Open Compliance Summit 2025 | Save the date'), scope)).toBe('other-edition');
  });

  it('recognises the OS Summit Japan templates through the co-brands', () => {
    const scope = deriveEmailTemplateScope(details('Open Source Summit Japan + AutoLinux + Embedded Linux 2026', 'Tokyo', 'JP')) as CampaignEmailTemplateScope;
    expect(classifyEmailTemplate(row('OS Summit Japan + AutoLinux + Embedded Linux 2026 | Explore the Tracks'), scope)).toBe('this-edition');
    expect(classifyEmailTemplate(row('2 Weeks Until Open Source Summit + ELC Europe 2026'), scope)).toBe('other-edition');
  });
});

describe('parseEventStartDate', () => {
  it('reads the first day from the forms event pages write', () => {
    expect(parseEventStartDate('19-20 November 2026')).toBe('2026-11-19');
    expect(parseEventStartDate('April 24-27, 2028')).toBe('2028-04-24');
    expect(parseEventStartDate('March 30 - April 2, 2027')).toBe('2027-03-30');
    expect(parseEventStartDate('Sept 8–10 2026')).toBe('2026-09-08');
    expect(parseEventStartDate('2028-04-24 – 2028-04-27')).toBe('2028-04-24');
    // No year in the dates: the year from the event's name.
    expect(parseEventStartDate('December 8-10', '2026')).toBe('2026-12-08');
  });

  it('returns nothing when no real day can be read', () => {
    expect(parseEventStartDate('')).toBe('');
    expect(parseEventStartDate(undefined)).toBe('');
    expect(parseEventStartDate('Self-paced')).toBe('');
    expect(parseEventStartDate('November 2026')).toBe('');
    expect(parseEventStartDate('Marketing week 12, 2026')).toBe('');
    expect(parseEventStartDate('31 April 2027')).toBe('');
  });
});

describe('classifyEmailTemplate against the edition dates', () => {
  // An annual event names its emails the same way every year, so only the edit date tells this
  // year's "2 Weeks Until KubeCon + CloudNativeCon Europe" from last year's.
  const dated = (name: string, updatedAt: string): HubSpotMarketingEmail => ({ ...row(name), updatedAt });
  const europe = deriveEmailTemplateScope({ ...details('KubeCon + CloudNativeCon Europe 2028'), dates: 'April 24-27, 2028' }) as CampaignEmailTemplateScope;

  it('dates a year-less send by when it was last edited', () => {
    expect(europe.editionStart).toBe('2028-04-24');
    expect(classifyEmailTemplate(dated('2 Weeks Until KubeCon + CloudNativeCon Europe Takes Over Amsterdam', '2026-03-10T12:00:00Z'), europe)).toBe(
      'other-edition'
    );
    expect(classifyEmailTemplate(dated('Last Chance to Save on KubeCon + CloudNativeCon Europe', '2027-11-12T12:00:00Z'), europe)).toBe('this-edition');
    // Long after this edition: the next one's.
    expect(classifyEmailTemplate(dated('Thank You for Joining KubeCon + CloudNativeCon Europe', '2028-12-01T12:00:00Z'), europe)).toBe('other-edition');
  });

  it("trusts a template that names this edition's year over its edit date", () => {
    expect(classifyEmailTemplate(dated('Save the Date: KubeCon + CloudNativeCon Europe 2028', '2026-11-20T12:00:00Z'), europe)).toBe('this-edition');
  });

  it('bounds the edit date by the year alone when the brief has no dates', () => {
    const yearOnly = deriveEmailTemplateScope(details('Kubecon Cloudnativecon Europe 2028')) as CampaignEmailTemplateScope;
    expect(yearOnly.editionStart).toBe('');
    expect(classifyEmailTemplate(dated('Last Chance to Save on KubeCon + CloudNativeCon Europe', '2026-11-12T12:00:00Z'), yearOnly)).toBe('other-edition');
    expect(classifyEmailTemplate(dated('Last Chance to Save on KubeCon + CloudNativeCon Europe', '2027-06-01T12:00:00Z'), yearOnly)).toBe('this-edition');
    // No edit date at all: judged on its name, as before.
    expect(classifyEmailTemplate(row('Last Chance to Save on KubeCon + CloudNativeCon Europe'), yearOnly)).toBe('this-edition');
  });
});

describe('namesEditionPlace', () => {
  it("tells the same place's other editions from the brand's other series", () => {
    const europe = deriveEmailTemplateScope(details('KubeCon + CloudNativeCon Europe 2028')) as CampaignEmailTemplateScope;
    expect(namesEditionPlace(row('Registration Is Open! KubeCon + CloudNativeCon Europe 2027'), europe)).toBe(true);
    expect(namesEditionPlace(row('KubeCon EU | Last Chance'), europe)).toBe(true);
    expect(namesEditionPlace(row('KubeCon + CloudNativeCon India 2026: Early Bird Registration'), europe)).toBe(false);
    expect(namesEditionPlace(row('KubeCon NA 2026 - Modern Registration Template'), europe)).toBe(false);
  });
});

describe('isSentEmailTemplate', () => {
  it('counts published and scheduled emails, including A/B parents, as sent', () => {
    expect(isSentEmailTemplate(row('a', 'PUBLISHED'))).toBe(true);
    expect(isSentEmailTemplate(row('a', 'PUBLISHED_AB'))).toBe(true);
    expect(isSentEmailTemplate(row('a', 'SCHEDULED'))).toBe(true);
    expect(isSentEmailTemplate(row('a', 'DRAFT'))).toBe(false);
    expect(isSentEmailTemplate({ id: 'x' })).toBe(false);
  });
});

describe('edition aliases', () => {
  it('reads an abbreviated event name as its full edition name too', () => {
    const scope = deriveEmailTemplateScope(details('KubeCon + CloudNativeCon NA 2026'));
    expect(scope?.editionTerms).toEqual(expect.arrayContaining(['na', 'north america']));
    expect(namesEditionPlace(row('KubeCon North America 2026 | Last Chance'), scope as CampaignEmailTemplateScope)).toBe(true);
  });

  it('does not read the pronoun "us" as the United States, in a name or a subject', () => {
    const scope = deriveEmailTemplateScope(details('KubeCon + CloudNativeCon North America 2026', 'Salt Lake City', 'US')) as CampaignEmailTemplateScope;
    expect(namesEditionPlace(row('KubeCon Europe 2026', 'PUBLISHED', 'Join us in Amsterdam'), scope)).toBe(false);
    expect(namesEditionPlace(row('Join us at KubeCon Europe 2026'), scope)).toBe(false);
    // In capitals it is the abbreviation, and still names the edition.
    expect(namesEditionPlace(row('KubeCon US 2026 | Agenda'), scope)).toBe(true);
  });
});
