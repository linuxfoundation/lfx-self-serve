// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CampaignEventDetails, CampaignEventSponsor } from '../interfaces/campaign.interface';

/**
 * An unknown value coerced into a `CampaignEventDetails` with every declared field present.
 *
 * `CampaignEventDetails` declares its fields non-optional, but every producer of one is a scrape
 * or a reload of a previously scraped blob — a page that does not state its dates yields an object
 * with that key MISSING, and a blob written by an older build is missing whatever fields were
 * added since. Asserting the type (`value as CampaignEventDetails`) makes the compiler enforce
 * nothing and lets `undefined` reach a template, which renders the string "undefined" rather than
 * nothing, and `setValue()` on the edit form, which puts "undefined" in an input the user has to
 * clear.
 *
 * Empty string, not a dash, for an absent value: this object is persisted and fed to email copy
 * generation, so a dash would put a literal "—" into an email body. A dash is a DISPLAY choice and
 * belongs at the interpolation that wants one.
 *
 * This lives in the shared package because it has two callers in two runtimes — the Angular
 * planning tab normalising an SSE `event` frame, and the Express service reading a saved brief
 * back out of the database. They drifted while each had its own copy: the server's version silently
 * dropped `heroImageUrl` and `sponsors`, so dispatching from a RELOADED brief produced an email
 * with no hero and no sponsor logos, which looks identical to a hero that failed to upload. One
 * conversion means a field added to the interface cannot be honoured by one reader and forgotten
 * by the other.
 */
export function coerceCampaignEventDetails(value: unknown): CampaignEventDetails {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const text = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  const list = (key: string): string[] =>
    Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter((entry): entry is string => typeof entry === 'string') : [];
  // Every URL-bearing field is scheme-checked on the way back OUT, not only on the way in.
  //
  // Only the fresh-scrape path validated these. A value saved through the brief API -- which
  // accepts arbitrary strings -- was read back verbatim, and these fields are printed as
  // hyperlinks in the email. A `javascript:` or `data:` href therefore reached an `href`
  // consumer that has no sandbox, in markup sent under the foundation's name.
  //
  // Applied to all SIX url fields, not the four that were reported: `registrationUrl` rides on
  // the same path and `heroImageUrl` becomes an `src`, so exempting them would leave the same
  // hole one field over.
  const url = (key: string): string => {
    const value = text(key);
    if (value === '') return '';
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value : '';
    } catch {
      // Not absolute, so there is no scheme to vouch for. A relative value cannot be resolved
      // here -- the coercer has no base -- and emitting it as an href would produce a link
      // relative to whatever renders it.
      return '';
    }
  };

  return {
    name: text('name'),
    dates: text('dates'),
    city: text('city'),
    countryCode: text('countryCode'),
    audience: text('audience'),
    themes: list('themes'),
    registrationUrl: url('registrationUrl'),
    speakers: list('speakers'),
    slug: text('slug'),
    formatNotes: text('formatNotes'),
    description: text('description'),
    agendaUrl: url('agendaUrl'),
    cfpUrl: url('cfpUrl'),
    venueUrl: url('venueUrl'),
    sponsorshipUrl: url('sponsorshipUrl'),
    heroImageUrl: url('heroImageUrl'),
    sponsors: coerceCampaignEventSponsors(raw['sponsors']),
  };
}

/**
 * Sponsor entries that can actually be rendered.
 *
 * An entry with no `logoUrl` is dropped rather than kept with an empty one: the only consumer is a
 * logo wall (in the brief preview and in the dispatched email's sponsor tier), so a sponsor with no
 * image contributes an empty cell that reads as a broken layout. The NAME is allowed to be empty —
 * it comes from `alt` text, which plenty of real logo markup omits, and a logo with no alt text
 * still renders.
 */
function coerceCampaignEventSponsors(value: unknown): CampaignEventSponsor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      name: typeof entry['name'] === 'string' ? entry['name'] : '',
      logoUrl: typeof entry['logoUrl'] === 'string' ? entry['logoUrl'] : '',
    }))
    .filter((sponsor) => sponsor.logoUrl.length > 0);
}
