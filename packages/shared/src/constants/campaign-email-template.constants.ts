// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Vocabulary for scoping the email template picker to an event's brand and edition.
 *
 * The LF HubSpot portal holds every brand's email: newsletters, education promos, surveys and the
 * emails of dozens of events. Staging an event email clones one of them, and the clone decides the
 * sender, subscription type and office location, so the picker should offer the event's own
 * brand and nothing else. `deriveEmailTemplateScope` reads the brand from the event name by
 * removing the edition (region, country, city, year), and these lists are what it removes.
 */

/**
 * Region phrases that name an edition rather than a brand ("KubeCon + CloudNativeCon NORTH AMERICA").
 *
 * Matched as whole-word phrases after normalisation. Longer phrases are listed before the words
 * they contain so "latin america" is removed as one edition rather than leaving "latin".
 */
export const EMAIL_TEMPLATE_REGION_PHRASES: readonly string[] = [
  'north america',
  'south america',
  'latin america',
  'central america',
  'asia pacific',
  'middle east',
  'europe',
  'asia',
  'africa',
  'oceania',
  'nordics',
  'apac',
  'emea',
  'latam',
];

/**
 * How templates abbreviate an edition's region. "KubeCon + CloudNativeCon NA 2026 | Last Chance"
 * belongs to the North America edition even though it never spells it out.
 */
export const EMAIL_TEMPLATE_REGION_ABBREVIATIONS: Readonly<Record<string, readonly string[]>> = {
  'north america': ['na'],
  europe: ['eu'],
  'latin america': ['latam'],
  'asia pacific': ['apac'],
  'united states': ['us', 'usa'],
  'united kingdom': ['uk'],
  'south korea': ['korea'],
};

/**
 * Words that cannot identify a brand on their own. A segment made only of these ("Summit",
 * "Open Source") is not searched for, because it would match every summit in the portal.
 */
export const EMAIL_TEMPLATE_GENERIC_WORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'of',
  'for',
  'in',
  'on',
  'a',
  'an',
  'con',
  'conference',
  'summit',
  'day',
  'days',
  'event',
  'events',
  'open',
  'source',
  'community',
  'global',
  'virtual',
  'online',
  'annual',
  'workshop',
  'workshops',
  'meetup',
  'forum',
  'expo',
  'week',
  'edition',
  'series',
  'live',
]);

/**
 * How many brand phrases one scoped search sends. campaign-service's `match` accepts at most 8; a
 * real event name yields two or three.
 */
export const EMAIL_TEMPLATE_SCOPE_MAX_PHRASES = 8;

/** The longest phrase campaign-service's `match` accepts. */
export const EMAIL_TEMPLATE_SCOPE_MAX_PHRASE_LENGTH = 120;

/**
 * Template lifecycle states that are never a clone source for a new send.
 *
 * Automated (workflow) emails belong to a workflow and send on its trigger, and the B half of an
 * A/B pair is not an email of its own. Matched on the state's substrings so HubSpot's composite
 * states ("AUTOMATED_DRAFT", "PUBLISHED_AB_VARIANT") are covered.
 */
export const EMAIL_TEMPLATE_EXCLUDED_STATE_PARTS: readonly string[] = ['AUTOMATED', 'AB_VARIANT'];

/**
 * A draft this app staged: campaign-service names each clone "<event> — <brief id>". It is the
 * app's own unreviewed output, not a template, and cloning it chains clones of clones.
 */
export const EMAIL_TEMPLATE_STAGED_DRAFT_PATTERN = /\s[—-]\s[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** Template names that are someone's experiment rather than a design to reuse. */
export const EMAIL_TEMPLATE_TEST_NAME_PATTERN = /\b(test|testing|sample|dummy|do not use)\b/i;

/**
 * An event email is not a newsletter. A brand's newsletter mentions its events constantly, so the
 * brand search finds it, but its layout, subscription and audience are the newsletter's.
 */
export const EMAIL_TEMPLATE_NEWSLETTER_PATTERN = /\bnewsletter\b/i;

/** A DRAFT copy ("... (Clone)") of another email, which is someone's work in progress, not a template. */
export const EMAIL_TEMPLATE_DRAFT_CLONE_PATTERN = /\(clone\)/i;

/** States that mean the email actually went out (or is booked to), which makes it a proven design. */
export const EMAIL_TEMPLATE_SENT_STATE_PREFIXES: readonly string[] = ['PUBLISHED', 'SCHEDULED'];

/**
 * Ranking weights for a SCOPED template list, added on top of the picker's type-keyword and event
 * score. This edition's templates come first, then emails that actually went out, then the usual
 * ordering -- each weight is far above anything the next tier can add, so the tiers never mix.
 */
export const EMAIL_TEMPLATE_RANK_THIS_EDITION_WEIGHT = 1000;
export const EMAIL_TEMPLATE_RANK_SENT_WEIGHT = 100;

/**
 * Between the two: a template from another edition that names THIS edition's place (region,
 * country, city or their abbreviations) -- last year's Europe sends for a Europe brief. Its sender,
 * subscription and office location are the ones this region uses, so before an edition has
 * templates of its own, these are the right clone sources, not the brand's other regional series.
 */
export const EMAIL_TEMPLATE_RANK_SAME_PLACE_WEIGHT = 500;

/**
 * How far before an edition's first day a template can have been edited and still be that
 * edition's. A brand's annual event names its emails the same way every year ("2 Weeks
 * Until KubeCon + CloudNativeCon Europe"), so the name alone cannot tell this year's from last
 * year's; when it names no year, the edit date decides. About ten months: promotion rarely starts
 * earlier, and the previous edition's own sends sit about twelve months back. A save-the-date sent
 * earlier still is listed under the other editions, one click away.
 */
export const EMAIL_TEMPLATE_EDITION_LEAD_MS = 300 * 86_400_000;

/** How long after an edition's first day its follow-ups (thank-you, recordings, survey) are edited: about four months. */
export const EMAIL_TEMPLATE_EDITION_TRAIL_MS = 120 * 86_400_000;

/**
 * Month names in calendar order, for reading an edition's first day out of the brief's free-text
 * dates ("19-20 November 2026", "April 24-27, 2028"). A word of three letters or more that starts
 * one of them is that month, so "Sept", "Sep" and "September" all read as September and "Marketing"
 * reads as nothing.
 */
export const EVENT_DATE_MONTH_NAMES: readonly string[] = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
