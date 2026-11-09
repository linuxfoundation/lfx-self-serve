// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CAMPAIGN_ACTION_RULE_LEVERS,
  CAMPAIGN_DISPATCH_CONNECTION_NOT_USABLE_PATTERN,
  CAMPAIGN_DISPATCH_CONNECTION_REASON_NEXT_STEPS,
  CAMPAIGN_DISPATCH_NOTHING_CREATED_SUFFIXES,
  CAMPAIGN_FUNNEL_STAGE_COLUMN_LABELS,
  CAMPAIGN_LABEL_ABSENT,
  CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS,
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_SURVEY_GENERIC_PAGE_SEGMENTS,
  CAMPAIGN_SURVEY_SOURCE_TEXT_MAX_CHARS,
  CAMPAIGN_SURVEY_SOURCE_TEXT_RAW_MAX_CHARS,
  CAMPAIGN_TACTIC_OPTIONS,
  GOOGLE_CAMPAIGN_CHANNEL_LABELS,
  GOOGLE_MIN_DAILY_BUDGET_USD,
  MAX_NEGATIVE_KEYWORD_TEXT_LENGTH,
  MAX_SPONSORS,
  MAX_SPONSOR_NAME_LENGTH,
  NEGATIVE_KEYWORD_TEXT_PATTERN,
} from '../constants/campaign.constants';
import type {
  BriefMetricsActionRule,
  CampaignDispatchFailureDescription,
  CampaignEventSponsor,
  CampaignIndexDoc,
  CampaignLabelColumns,
  CampaignOptimizeLever,
  KeywordActionPlatform,
  NegativeKeywordInputProblem,
  ParsedNegativeKeywordInput,
} from '../interfaces/campaign.interface';
import { sanitizeDisplayText } from './html-utils';
import { canonicalHttpUrl } from './url.utils';

/**
 * The sponsor list exactly as it will be staged: sanitized, bounded, and capped.
 *
 * ONE implementation because the preview and the wire must agree. The component rendered this
 * list and the controller rebuilt it, and the two drifted repeatedly -- blank names kept in one
 * and dropped in the other, the name cap applied in one only, the sanitizer added to one first.
 * Each drift showed the operator a sponsor the sent draft omits, or vice versa.
 *
 * @param sponsors - Raw entries from a scraped brief or a direct request; any shape
 * @param preSliceFactor - Entries to keep BEFORE the per-entry URL parse, as a multiple of
 *   MAX_SPONSORS. The server bounds untrusted input this way so a direct request cannot make it
 *   parse an unbounded list; the client's input is already bounded, so it passes 1.
 * @returns At most MAX_SPONSORS entries, each with a non-empty name and a usable http(s) logo
 */
export function normalizeSponsors(sponsors: unknown, preSliceFactor = 1): CampaignEventSponsor[] {
  if (!Array.isArray(sponsors)) return [];
  return sponsors
    .filter((sponsor): sponsor is { name: string; logoUrl?: unknown } => !!sponsor && typeof sponsor.name === 'string')
    .slice(0, MAX_SPONSORS * preSliceFactor)
    .map((sponsor) => ({
      name: sanitizeDisplayText([...sponsor.name.trim()].slice(0, MAX_SPONSOR_NAME_LENGTH).join('')),
      logoUrl: canonicalHttpUrl(sponsor.logoUrl),
    }))
    .filter((sponsor) => sponsor.name !== '' && sponsor.logoUrl !== '')
    .slice(0, MAX_SPONSORS);
}

/**
 * The lever a monitor rule maps to, ignoring platform.
 *
 * Total over ANY input: the wire's `rule` is typed closed but is not validated, so a token added
 * upstream later, a non-string, or an inherited key like `toString` all resolve to `none` rather
 * than to `undefined` or a prototype member.
 */
export function campaignActionRuleLever(rule: unknown): CampaignOptimizeLever {
  if (typeof rule !== 'string' || !Object.prototype.hasOwnProperty.call(CAMPAIGN_ACTION_RULE_LEVERS, rule)) {
    return 'none';
  }
  return CAMPAIGN_ACTION_RULE_LEVERS[rule as BriefMetricsActionRule];
}

/**
 * The lever that resolves a monitor finding on a campaign of `platform`, or `none`.
 *
 * `none` when the rule has no lever, and also when the platform cannot take it — X has no
 * pause/resume here, and keyword actions are Google Ads and Microsoft Advertising only — so a
 * finding never offers a control that would refuse its campaign.
 */
export function campaignActionItemLever(rule: unknown, platform: unknown): CampaignOptimizeLever {
  const lever = campaignActionRuleLever(rule);
  if (lever === 'none') {
    return 'none';
  }
  return typeof platform === 'string' && CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS[lever].has(platform) ? lever : 'none';
}

/**
 * Parse the negative-keyword editor's text: one keyword per line, blank lines ignored.
 *
 * Each kept line is normalised the way campaign-service normalises it before sending it to the
 * platform (whitespace collapsed to one space, trimmed; case kept), so what the editor shows as
 * sent is what upstream echoes back. The checks mirror the BFF's and upstream's own, so a batch
 * this accepts is not refused for its shape: the character set (`NEGATIVE_KEYWORD_TEXT_PATTERN`),
 * `maxTextLength` counted in characters rather than UTF-16 units, no two punctuation characters
 * together, and no keyword twice (compared case-insensitively). The count limit is the caller's to
 * check, against `keywords.length`.
 *
 * `maxTextLength` defaults to the shared `MAX_NEGATIVE_KEYWORD_TEXT_LENGTH` the BFF enforces, and a
 * caller that knows the campaign's platform passes that platform's own, shorter limit instead
 * (`CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES.maxTextLength` — Google Ads caps text at 80).
 */
export function parseNegativeKeywordInput(text: unknown, maxTextLength: number = MAX_NEGATIVE_KEYWORD_TEXT_LENGTH): ParsedNegativeKeywordInput {
  const keywords: string[] = [];
  const problems: NegativeKeywordInputProblem[] = [];
  if (typeof text !== 'string') {
    return { keywords, problems };
  }
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const keyword = raw.replace(/\s+/g, ' ').trim();
    if (keyword === '') {
      return;
    }
    const line = i + 1;
    const reason = negativeKeywordProblem(keyword, seen, maxTextLength);
    if (reason !== null) {
      problems.push({ line, text: keyword, reason });
      return;
    }
    seen.add(keyword.toLocaleLowerCase());
    keywords.push(keyword);
  });
  return { keywords, problems };
}

function negativeKeywordProblem(keyword: string, seen: ReadonlySet<string>, maxTextLength: number): string | null {
  if ([...keyword].length > maxTextLength) {
    return `Longer than ${maxTextLength} characters.`;
  }
  if (!NEGATIVE_KEYWORD_TEXT_PATTERN.test(keyword)) {
    return "Use only letters, digits, spaces and & ' - .";
  }
  if (/[&'.-]{2}/.test(keyword)) {
    return 'Two punctuation characters cannot be next to each other.';
  }
  if (seen.has(keyword.toLocaleLowerCase())) {
    return 'Listed more than once.';
  }
  return null;
}

/**
 * The key a keyword's action state is stored under on the Optimize tab.
 *
 * Google's key is unchanged (`adGroupId-criterionId`); Microsoft's is prefixed with its platform,
 * because Google and Microsoft mint ids in unrelated spaces and the same digits could name one
 * keyword on each — sharing a key would show one platform's outcome against the other's row.
 */
export function keywordActionKey(platform: KeywordActionPlatform, adGroupId: string, criterionId: string): string {
  const base = `${adGroupId}-${criterionId}`;
  return platform === 'google-ads' ? base : `${platform}:${base}`;
}

/**
 * A keyword's stable identity across reads — (platform, campaign, ad group, criterion) — for state
 * that must outlive the table it was asked from, such as a keyword a confirmed REMOVE deleted.
 */
export function keywordIdentityKey(platform: KeywordActionPlatform, campaignId: string, adGroupId: string, criterionId: string): string {
  return `${platform}:${campaignId}:${adGroupId}:${criterionId}`;
}

/**
 * The row version a campaign-service ETag names, or `null` when it is not one.
 *
 * campaign-service's ETag is exactly `"<version>"`, quotes included (`briefETag`; see
 * `CampaignIndexDoc.etag`), and the version only ever grows. That makes two ETags of one row
 * ORDERABLE, which an opaque compare is not: an asynchronously indexed list can deliver an ETag that
 * differs from a validator this session confirmed yet is OLDER than it, and only the versions say so.
 * Anything else (a weak validator, an unquoted or non-numeric value) is not comparable: `null`.
 */
export function campaignEtagVersion(etag: string | null | undefined): number | null {
  if (typeof etag !== 'string') {
    return null;
  }
  const match = /^"(\d{1,15})"$/.exec(etag);
  return match ? Number(match[1]) : null;
}

/**
 * Reads a campaign-service platform `error` (issue #208's `DispatchFailureMessage`) for display.
 *
 * Two things, both keyed on backend-fixed text only (see the constants' docs for why that text is
 * safe to match and what happens when it drifts):
 *
 * - a project-connection sentence with a known reason token gets an operator next step, and its
 *   `(reason: <token>)` fragment is dropped from `message` because the step replaces it; an
 *   unknown token, or any other sentence, is returned verbatim with no step;
 * - a sentence ending in one of the pre-create suffixes is flagged `nothingCreated`.
 *
 * `error` is only ever rendered as text by the caller, never as HTML.
 */
export function describeCampaignDispatchFailure(error: string): CampaignDispatchFailureDescription {
  const nothingCreated = CAMPAIGN_DISPATCH_NOTHING_CREATED_SUFFIXES.some((suffix) => error.endsWith(suffix));
  const match = CAMPAIGN_DISPATCH_CONNECTION_NOT_USABLE_PATTERN.exec(error);
  if (!match) {
    return { message: error, nextStep: null, nothingCreated };
  }
  const [, provider, token] = match;
  const template = Object.prototype.hasOwnProperty.call(CAMPAIGN_DISPATCH_CONNECTION_REASON_NEXT_STEPS, token)
    ? CAMPAIGN_DISPATCH_CONNECTION_REASON_NEXT_STEPS[token]
    : undefined;
  if (!template) {
    return { message: error, nextStep: null, nothingCreated };
  }
  const label = CAMPAIGN_PLATFORMS.find((p) => p.id === provider)?.label ?? provider;
  return {
    message: error.replace(` (reason: ${token})`, ''),
    nextStep: template.replace('{platform}', label),
    nothingCreated,
  };
}

/**
 * A survey source document's length as campaign-service measures it: whitespace runs collapsed to
 * one space, trimmed, counted in code points (Go runes), so the page's counter and refusal agree
 * with the server's 400.
 */
export function campaignSurveySourceTextLength(sourceText: string): number {
  // Counted by iterating, not by spreading into an array: one array slot per character is the
  // cost a long paste should not have to pay just to be measured.
  // Unicode White_Space, which is exactly Go's `unicode.IsSpace` behind `strings.Fields`; JS `\s`
  // differs (it takes U+FEFF and misses U+0085). Only the spaces the collapse leaves are trimmed,
  // since `trim()` would also strip a U+FEFF that upstream counts.
  const collapsed = sourceText.replace(/\p{White_Space}+/gu, ' ').replace(/^ | $/g, '');
  let count = 0;
  for (const _codePoint of collapsed) {
    count++;
  }
  return count;
}

/**
 * Whether a survey source is over campaign-service's limit. The raw length is checked FIRST, so a
 * body far past the limit is refused without being normalised or counted -- a request the server
 * is about to refuse should cost nothing in proportion to its size.
 */
export function campaignSurveySourceTextTooLong(sourceText: string): boolean {
  if (sourceText.length > CAMPAIGN_SURVEY_SOURCE_TEXT_RAW_MAX_CHARS) {
    return true;
  }
  return campaignSurveySourceTextLength(sourceText) > CAMPAIGN_SURVEY_SOURCE_TEXT_MAX_CHARS;
}

/** A value as a brief slug: lowercase ASCII words joined by hyphens, at most 100 characters. */
function slugifyForBrief(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/**
 * The slug a SURVEY brief is stored and looked up under -- ONE function for both, so a saved
 * survey is found again after a reload.
 *
 * The promoted link's last path segment, so two assets promoted from one link collide rather than
 * silently becoming separate briefs. Except where that segment names the PAGE rather than the
 * asset (every Google Form ends in `viewform`), or there is no path: those take the source
 * document's first non-empty line -- the asset's own title. '' when neither yields one.
 */
export function deriveSurveySlug(url: string, sourceText: string): string {
  let lastSegment = '';
  try {
    lastSegment = decodeURIComponent(new URL(url.trim()).pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    lastSegment = '';
  }
  const pageSegment = slugifyForBrief(lastSegment.replace(/\.[a-z0-9]+$/i, ''));
  if (pageSegment !== '' && !CAMPAIGN_SURVEY_GENERIC_PAGE_SEGMENTS.has(pageSegment)) {
    return pageSegment;
  }
  return slugifyForBrief(surveySourceTitle(sourceText));
}

/**
 * A survey source document's title: its first non-empty line, at most 120 characters. ONE copy,
 * shared by the slug above and the campaign name the BFF stores, so the two cannot drift.
 */
export function surveySourceTitle(sourceText: string): string {
  const title =
    sourceText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? '';
  return title.slice(0, 120);
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A `YYYY-MM-DD` date as a UTC day number, or `null` when the string is not a real calendar date. */
function calendarDayNumber(date: string): number | null {
  const match = CALENDAR_DATE_PATTERN.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  // A round trip refuses a date the constructor silently rolls over, such as 2026-02-30.
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return utc.getTime() / 86_400_000;
}

/**
 * How many days a campaign flight runs, counting the start and end days both (#4847).
 *
 * Both days count because Google runs a campaign from 00:00 on its start date to 23:59:59 on its
 * end date (campaign-service `validateFlightWindow`), so a same-day flight is one day of spend.
 * Counted on UTC day numbers so a daylight-saving change between the two dates cannot make the
 * count fractional.
 *
 * @param startDate - The flight's first day, `YYYY-MM-DD`
 * @param endDate - The flight's last day, `YYYY-MM-DD`
 * @returns The day count, or `null` when either date is not a real calendar date or the end is
 *   before the start
 */
export function campaignFlightDays(startDate: string, endDate: string): number | null {
  const start = calendarDayNumber(startDate);
  const end = calendarDayNumber(endDate);
  if (start === null || end === null || end < start) return null;
  return end - start + 1;
}

/**
 * Whether a flight ends BEFORE it starts, which Google refuses (#4848). A same-day flight is not
 * reversed: Google's test is campaign-service `validateFlightWindow`'s `end.Before(start)`.
 *
 * `false` for a date that is not a real `YYYY-MM-DD` calendar day, because this answers only the
 * reversed question; a blank date is the required validator's to report.
 */
export function isReversedCampaignFlight(startDate: string, endDate: string): boolean {
  const start = calendarDayNumber(startDate);
  const end = calendarDayNumber(endDate);
  return start !== null && end !== null && end < start;
}

/**
 * The daily budget that spends a total over a flight, rounded DOWN to the cent (#4847).
 *
 * Rounded down so the daily figure times the flight never exceeds the total it came from.
 *
 * @param total - The flight's total budget; positive and finite
 * @param days - The flight's length in days, from {@link campaignFlightDays}; a positive integer
 * @returns The daily amount, or `null` when either input is unusable
 */
export function dailyBudgetFromTotal(total: number, days: number): number | null {
  if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(days) || days < 1) return null;
  // Divides a whole number of cents, so the floor works on cents rather than on a float of dollars.
  // A total holding a fraction of a cent rounds UP here (31.309 to 3131), and dividing that would
  // overspend it, so step back to the cent below the total.
  let cents = Math.round(total * 100);
  if (cents / 100 > total) cents -= 1;
  return Math.floor(cents / days) / 100;
}

/**
 * The Google Ads UI link for one campaign, or `''` without an id: the one link format this app uses
 * for Google, on the create results and the Optimize views alike. It carries no customer (`__c`/`ocid`)
 * parameter, because no Google Ads customer id reaches this app, so Google opens it in the signed-in
 * user's default account; a user whose default is another account switches to the campaign's there.
 * The id is percent-encoded: ids are numeric, so this changes nothing in practice for one from upstream.
 *
 * @param campaignId - The Google Ads campaign id
 */
export function googleAdsCampaignUrl(campaignId: string | null | undefined): string {
  return campaignId ? `https://ads.google.com/aw/campaigns?campaignId=${encodeURIComponent(campaignId)}` : '';
}

const EVENT_DATE_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/**
 * A month name or its abbreviation, as a capture group, then an optional dot. The lookahead ends the
 * name at a word boundary, so a word that only STARTS like a month — Marriott, Janeiro, Junction,
 * Decatur — is not read as one. Every month pattern below is built from this one token.
 */
const EVENT_DATE_MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\\.?';
const EVENT_DATE_ORDINAL = '(?:st|nd|rd|th)?';
/** `March 15`, `Mar. 15th`: the month, then the day. */
const EVENT_DATE_MONTH_FIRST = new RegExp(`\\b${EVENT_DATE_MONTH}\\s+(\\d{1,2})${EVENT_DATE_ORDINAL}\\b`, 'i');
/** `15 March`, `15-16 March`: the (first) day, then the month. */
const EVENT_DATE_DAY_FIRST = new RegExp(
  `\\b(\\d{1,2})${EVENT_DATE_ORDINAL}(?:\\s*[-\u2013\u2014]\\s*\\d{1,2}${EVENT_DATE_ORDINAL})?\\s+${EVENT_DATE_MONTH}\\b`,
  'i'
);
const EVENT_DATE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const EVENT_DATE_YEAR = /\b(20\d{2})\b/;
const EVENT_DATE_YEARS = /\b20\d{2}\b/g;
/** Every month named, in order: used to spot a range that crosses into the next year. */
const EVENT_DATE_ANY_MONTH = new RegExp(`\\b${EVENT_DATE_MONTH}`, 'gi');

/**
 * The first day of an event, as `YYYY-MM-DD`, read from the brief's human-readable `dates` (#1614).
 *
 * The scrape asks for "human-readable date range" (`EVENT_EXTRACTION_PROMPT`), so the text is free
 * form. This reads the shapes event pages use — `2027-03-15`, `March 15, 2027`, `March 15-17, 2027`,
 * `March 30 - April 1, 2027`, `15 March 2027`, `15-17 March 2027`, with or without a weekday — and
 * takes the FIRST day of a range, with the first year written. A range that crosses New Year with the
 * year written once after it, `December 30 - January 2, 2027`, starts in the year before; written
 * after the start, `December 30, 2026 - January 2`, the year is the start's. Anything it cannot place on a real calendar day, a date with no year among them, is
 * `null`, so a caller keeps its own default rather than acting on a guess.
 *
 * @param dates - `CampaignEventDetails.dates`
 * @returns The event's first day, or `null` when the text does not name one
 */
export function campaignEventStartDate(dates: string | null | undefined): string | null {
  if (typeof dates !== 'string') return null;
  const iso = EVENT_DATE_ISO.exec(dates);
  if (iso) return calendarDayNumber(iso[0]) === null ? null : iso[0];
  const year = EVENT_DATE_YEAR.exec(dates)?.[1];
  if (year === undefined) return null;
  const monthFirst = EVENT_DATE_MONTH_FIRST.exec(dates);
  const dayFirst = EVENT_DATE_DAY_FIRST.exec(dates);
  // Whichever shape starts earlier is the start date: "30 March - 1 April" and "March 30 - April 1"
  // each also hold a later fragment the other pattern could read.
  let monthName: string;
  let day: string;
  let startAt: number;
  if (monthFirst && (!dayFirst || monthFirst.index <= dayFirst.index)) {
    [monthName, day, startAt] = [monthFirst[1], monthFirst[2], monthFirst.index];
  } else if (dayFirst) {
    [day, monthName, startAt] = [dayFirst[1], dayFirst[2], dayFirst.index];
  } else {
    return null;
  }
  const monthNumber = (name: string): number => EVENT_DATE_MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const month = monthNumber(monthName);
  // "December 30 - January 2, 2027" writes the year once, for the END: a later month numbered below the
  // start's, with the one year written after it, means the range crosses New Year and the start is in
  // the year before. Written BEFORE that month — "December 30, 2026 - January 2" — the year is the
  // start's own and is kept.
  const years = [...dates.matchAll(EVENT_DATE_YEARS)];
  const crossesYear =
    years.length === 1 &&
    [...dates.matchAll(EVENT_DATE_ANY_MONTH)].some((found) => found.index > startAt && monthNumber(found[1]) < month && years[0].index > found.index);
  const startYear = crossesYear ? Number(year) - 1 : Number(year);
  const date = `${startYear}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  return calendarDayNumber(date) === null ? null : date;
}

/**
 * The end date a campaign's flight opens with (#1614): the event's first day when the brief names one
 * after today, else the given fallback.
 *
 * Strictly after today, because every non-Google platform the same end date reaches refuses an end
 * that is not after its start (campaign-service's LinkedIn, Meta, Reddit, Microsoft and X preflights),
 * and the flight opens starting today. Google states no longest flight (`validateFlightWindow` checks
 * only the order of the two dates), so a later event is not capped.
 *
 * @param eventDates - `CampaignEventDetails.dates`
 * @param today - Today, `YYYY-MM-DD`
 * @param fallback - The end date to use when the event date is unknown or not after today
 */
export function defaultCampaignEndDate(eventDates: string | null | undefined, today: string, fallback: string): string {
  const event = campaignEventStartDate(eventDates);
  if (event === null) return fallback;
  const eventDay = calendarDayNumber(event);
  const todayDay = calendarDayNumber(today);
  return eventDay !== null && todayDay !== null && eventDay > todayDay ? event : fallback;
}

/**
 * The Google flight end and daily budget the brief seed opens with (#4847, #1614): the brief's total
 * divided over the days from today through `endDate`, both counted.
 *
 * Never below {@link GOOGLE_MIN_DAILY_BUDGET_USD}, the floor the budget control enforces, because a seed
 * under it opens the tab with Create blocked. When the total spread to `endDate` would fall under it —
 * a long run-up to a far event, or a small total — the flight is SHORTENED to the most days the total
 * funds at the floor, so the seed still spends no more than the brief planned and still runs as long
 * as it can. A total too small to fund two days at the floor (the shortest flight every other platform
 * accepts, since each refuses an end that is not after the start) keeps `endDate` and seeds the floor,
 * which the tab then shows beside the brief's own total.
 *
 * @param total - The brief's total budget, or `null` when it has none
 * @param today - The flight's first day, `YYYY-MM-DD`
 * @param endDate - The end date the flight would otherwise open with, `YYYY-MM-DD`
 * @returns The end date and daily budget to seed; `dailyBudget` is `null` when there is no usable total
 */
export function googleSeededFlight(total: number | null, today: string, endDate: string): { endDate: string; dailyBudget: number | null } {
  const days = campaignFlightDays(today, endDate);
  const daily = total !== null && days !== null ? dailyBudgetFromTotal(total, days) : null;
  if (daily === null || daily >= GOOGLE_MIN_DAILY_BUDGET_USD || total === null) return { endDate, dailyBudget: daily };
  const fundedDays = Math.floor(total / GOOGLE_MIN_DAILY_BUDGET_USD);
  const todayDay = calendarDayNumber(today);
  if (fundedDays < 2 || todayDay === null) return { endDate, dailyBudget: GOOGLE_MIN_DAILY_BUDGET_USD };
  const shortened = new Date((todayDay + fundedDays - 1) * 86_400_000).toISOString().slice(0, 10);
  return { endDate: shortened, dailyBudget: dailyBudgetFromTotal(total, fundedDays) };
}

/**
 * A campaign's channel, funnel stage, tactic and created date as a campaign list shows them (#4983).
 *
 * Each is "—" when absent. The index is unvalidated, so a value this build does not know is "—" too,
 * rather than raw text. The channel is a Google one only: Google's variant is the channel (search is
 * `default`), and every other platform has a single channel, so naming one there would add nothing.
 * A created date that does not parse is "—", never "Invalid Date".
 *
 * The date is the calendar day in `timeZone`, or in the runtime's own zone when omitted, which is the
 * viewer's in the browser. `null` means the viewer's zone is not known, as in a server render: Created is
 * then "—", and the browser dates it once it renders, so the server's day (UTC) is never shown to a viewer
 * whose day differs near midnight.
 */
export function campaignLabelColumns(
  campaign: Pick<CampaignIndexDoc, 'platform' | 'variant' | 'funnel_stage' | 'tactic' | 'created_at'>,
  timeZone?: string | null
): CampaignLabelColumns {
  return {
    channel: campaignChannelLabel(campaign.platform, campaign.variant),
    stage: lookupLabel(CAMPAIGN_FUNNEL_STAGE_COLUMN_LABELS, campaign.funnel_stage),
    tactic: CAMPAIGN_TACTIC_OPTIONS.find((option) => option.id === campaign.tactic)?.label ?? CAMPAIGN_LABEL_ABSENT,
    created: timeZone === null ? CAMPAIGN_LABEL_ABSENT : campaignCreatedLabel(campaign.created_at, timeZone),
  };
}

function campaignChannelLabel(platform: unknown, variant: unknown): string {
  if (platform !== 'google-ads' || typeof variant !== 'string') {
    return CAMPAIGN_LABEL_ABSENT;
  }
  return lookupLabel(GOOGLE_CAMPAIGN_CHANNEL_LABELS, variant === 'default' ? 'search' : variant);
}

function campaignCreatedLabel(createdAt: unknown, timeZone: string | undefined): string {
  if (typeof createdAt !== 'string' || createdAt === '') {
    return CAMPAIGN_LABEL_ABSENT;
  }
  const when = new Date(createdAt);
  if (Number.isNaN(when.getTime())) {
    return CAMPAIGN_LABEL_ABSENT;
  }
  return when.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...(timeZone === undefined ? {} : { timeZone }) });
}

function lookupLabel(labels: Readonly<Record<string, string>>, key: unknown): string {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : CAMPAIGN_LABEL_ABSENT;
}
