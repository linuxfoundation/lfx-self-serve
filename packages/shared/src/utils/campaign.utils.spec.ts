// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_ACTION_RULE_LEVERS,
  CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS,
  MAX_GOOGLE_NEGATIVE_KEYWORD_TEXT_LENGTH,
  MAX_NEGATIVE_KEYWORD_TEXT_LENGTH,
  MAX_SPONSORS,
  MAX_SPONSOR_NAME_LENGTH,
} from '../constants/campaign.constants';
import type { BriefMetricsActionRule, CampaignOptimizeLever } from '../interfaces/campaign.interface';
import {
  briefSlugYearCandidates,
  campaignActionItemLever,
  campaignActionRuleLever,
  campaignEtagVersion,
  campaignSurveySourceTextLength,
  campaignSurveySourceTextTooLong,
  deriveSurveySlug,
  surveySourceTitle,
  campaignEventStartDate,
  campaignFlightDays,
  campaignLabelColumns,
  dailyBudgetFromTotal,
  defaultCampaignEndDate,
  describeCampaignDispatchFailure,
  googleAdsCampaignUrl,
  googleSeededFlight,
  isReversedCampaignFlight,
  keywordActionKey,
  normalizeSponsors,
  parseNegativeKeywordInput,
} from './campaign.utils';

/**
 * Sponsor entries arrive from a SCRAPED page: attacker-influenced names and logo urls that reach
 * a sent email. Coverage was indirect only, through the controller and component specs, so the
 * bounds and the per-entry sanitizing had nothing asserting them directly.
 */
describe('normalizeSponsors', () => {
  const logo = (n: number): string => `https://cdn.example.com/${n}.png`;

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not an array'],
    ['an object', { name: 'x' }],
  ])('returns [] for %s rather than throwing', (_label, input) => {
    expect(normalizeSponsors(input)).toEqual([]);
  });

  it('drops an entry whose name is not a string', () => {
    // The type guard, not cosmetics: `sponsor.name.trim()` below would throw on a non-string.
    expect(
      normalizeSponsors([
        { name: 42, logoUrl: logo(1) },
        { name: 'Acme', logoUrl: logo(2) },
      ])
    ).toEqual([{ name: 'Acme', logoUrl: logo(2) }]);
  });

  it('drops an entry with no usable logo url', () => {
    // `canonicalHttpUrl` returns '' for a private host, a bad scheme or a non-default port, and
    // an entry with no logo has nothing to render.
    const sponsors = normalizeSponsors([
      { name: 'Private', logoUrl: 'https://10.0.0.1/logo.png' },
      { name: 'Javascript', logoUrl: 'javascript:alert(1)' },
      { name: 'OddPort', logoUrl: 'https://cdn.example.com:8443/logo.png' },
      { name: 'Good', logoUrl: logo(1) },
    ]);

    expect(sponsors).toEqual([{ name: 'Good', logoUrl: logo(1) }]);
  });

  it('sanitizes the name, because it reaches a recipient as display text', () => {
    // A BIDI override renders a name as something other than what it contains.
    const [sponsor] = normalizeSponsors([{ name: 'Acme\u202Ekcatta', logoUrl: logo(1) }]);

    expect(sponsor?.name).not.toContain('\u202E');
  });

  it('drops an entry whose name sanitizes to nothing', () => {
    // Invisible-only names render blank while reading as non-empty.
    expect(normalizeSponsors([{ name: '\u200B\u200B', logoUrl: logo(1) }])).toEqual([]);
  });

  it('truncates a long name by CODE POINT, not by UTF-16 unit', () => {
    // `.slice()` on the string would cut an astral character in half and leave a lone surrogate.
    const [sponsor] = normalizeSponsors([{ name: '😀'.repeat(MAX_SPONSOR_NAME_LENGTH + 10), logoUrl: logo(1) }]);

    expect([...(sponsor?.name ?? '')]).toHaveLength(MAX_SPONSOR_NAME_LENGTH);
  });

  it('caps the result at MAX_SPONSORS', () => {
    const many = Array.from({ length: MAX_SPONSORS + 5 }, (_, i) => ({ name: `S${i}`, logoUrl: logo(i) }));

    expect(normalizeSponsors(many)).toHaveLength(MAX_SPONSORS);
  });

  it('parses only the pre-sliced window, never the whole list', () => {
    // `toHaveLength(MAX_SPONSORS)` alone proves nothing here -- the FINAL slice guarantees it
    // whether or not the pre-slice exists. What the pre-slice actually buys is not parsing
    // entries beyond the window, so this counts the parses: a getter on `logoUrl` fires once per
    // entry the pipeline touches.
    //
    // The caller that passes a wider factor is `campaign.controller.ts` (a DIRECT request, whose
    // list is unbounded), not the scrape path.
    let parsed = 0;
    const counting = Array.from({ length: 5000 }, (_, i) => ({
      name: `S${i}`,
      get logoUrl(): string {
        parsed++;
        return logo(i);
      },
    }));

    expect(normalizeSponsors(counting)).toHaveLength(MAX_SPONSORS);
    expect(parsed).toBe(MAX_SPONSORS);
  });

  it('lets preSliceFactor keep entries the default would have cut before parsing', () => {
    // The first MAX_SPONSORS entries are all unusable; the good ones sit past that window. With
    // the default factor they are pre-sliced away and the result is empty.
    const unusable = Array.from({ length: MAX_SPONSORS }, (_, i) => ({ name: `Bad${i}`, logoUrl: 'javascript:alert(1)' }));
    const list = [...unusable, { name: 'Good', logoUrl: logo(1) }];

    expect(normalizeSponsors(list)).toEqual([]);
    expect(normalizeSponsors(list, 2)).toEqual([{ name: 'Good', logoUrl: logo(1) }]);
  });
});

/**
 * Monitor finding → Optimize lever. The mapping decides which control an operator is handed for a
 * finding about live spend, so every rule is pinned explicitly rather than sampled.
 */
describe('campaignActionRuleLever', () => {
  // Every token campaign-service's brief rule engine emits (internal/service/rules/actions.go).
  // Listed here independently of the map, so a rule dropped from the map fails this spec.
  const expected: Record<BriefMetricsActionRule, CampaignOptimizeLever> = {
    zero_delivery: 'pause_resume',
    underspending: 'budget',
    budget_constrained: 'budget',
    low_ctr: 'none',
    no_conversions: 'none',
  };

  it('covers exactly the rule engine tokens, no more and no fewer', () => {
    expect(Object.keys(CAMPAIGN_ACTION_RULE_LEVERS).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.entries(expected))('maps %s to %s', (rule, lever) => {
    expect(campaignActionRuleLever(rule)).toBe(lever);
  });

  it.each([
    ['an unknown token', 'paused_should_run'],
    ['an empty string', ''],
    ['an inherited key', 'toString'],
    ['a prototype key', '__proto__'],
    ['a different case', 'UNDERSPENDING'],
    ['a number', 7],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to none for %s', (_label, rule) => {
    expect(campaignActionRuleLever(rule)).toBe('none');
  });
});

describe('campaignActionItemLever', () => {
  const allPlatforms = ['google-ads', 'microsoft-ads', 'linkedin-ads', 'meta-ads', 'reddit-ads', 'twitter-ads'];

  // X included since #3299: campaign-service writes its budget as a daily amount.
  it.each(['google-ads', 'linkedin-ads', 'meta-ads', 'microsoft-ads', 'reddit-ads', 'twitter-ads'])('offers the budget lever on %s', (platform) => {
    expect(campaignActionItemLever('underspending', platform)).toBe('budget');
    expect(campaignActionItemLever('budget_constrained', platform)).toBe('budget');
  });

  // Gated on the SAME set the row toggle uses, so the lever can never be offered where the toggle
  // itself would be unavailable for the platform.
  it.each(allPlatforms)('offers pause/resume on %s exactly when the row toggle supports it', (platform) => {
    const expected = CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS.pause_resume.has(platform) ? 'pause_resume' : 'none';
    expect(campaignActionItemLever('zero_delivery', platform)).toBe(expected);
  });

  // Microsoft keyword actions run through campaign-service since #3308; every other platform has none.
  it.each(allPlatforms)('restricts keyword actions to Google Ads and Microsoft Advertising (%s)', (platform) => {
    expect(CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS.keywords.has(platform)).toBe(platform === 'google-ads' || platform === 'microsoft-ads');
  });

  // No rule is mapped to the bid or negative-keyword levers: the rule engine's advice for none of
  // them is a bid change or a negative keyword, so every rule's lever is one of the three below.
  it('maps no rule to a lever outside budget, pause/resume and none', () => {
    expect(new Set(Object.values(CAMPAIGN_ACTION_RULE_LEVERS))).toEqual(new Set(['budget', 'pause_resume', 'none']));
  });

  it.each(allPlatforms)('offers nothing for a rule without a lever on %s', (platform) => {
    expect(campaignActionItemLever('low_ctr', platform)).toBe('none');
    expect(campaignActionItemLever('no_conversions', platform)).toBe('none');
  });

  it.each([
    ['an unknown platform', 'hubspot'],
    ['an empty platform', ''],
    ['a missing platform', undefined],
    ['a non-string platform', 42],
  ])('offers nothing for %s', (_label, platform) => {
    expect(campaignActionItemLever('underspending', platform)).toBe('none');
    expect(campaignActionItemLever('zero_delivery', platform)).toBe('none');
  });

  it('offers nothing for an unknown rule on a supported platform', () => {
    expect(campaignActionItemLever('some_future_rule', 'google-ads')).toBe('none');
  });
});

describe('parseNegativeKeywordInput', () => {
  it('keeps one keyword per line, in order, ignoring blank lines and normalising whitespace', () => {
    expect(parseNegativeKeywordInput('free download\n\n  cheap   tickets \r\njobs')).toEqual({
      keywords: ['free download', 'cheap tickets', 'jobs'],
      problems: [],
    });
  });

  it('accepts the allowed punctuation and non-Latin letters', () => {
    expect(parseNegativeKeywordInput("rock & roll\nO'Brien\nk8s-tutorial\nv1.2\ncafé\n東京").problems).toEqual([]);
  });

  it('reports each line it cannot send, by its 1-based line number, and does not send it', () => {
    const parsed = parseNegativeKeywordInput('good\nbad!\n\nfoo--bar\nGood');
    expect(parsed.keywords).toEqual(['good']);
    expect(parsed.problems.map((p) => [p.line, p.text])).toEqual([
      [2, 'bad!'],
      [4, 'foo--bar'],
      [5, 'Good'],
    ]);
    expect(parsed.problems[0].reason).toContain('letters, digits, spaces');
    expect(parsed.problems[1].reason).toContain('punctuation');
    expect(parsed.problems[2].reason).toContain('more than once');
  });

  // Characters, not UTF-16 units, as upstream counts them.
  it('counts length in characters', () => {
    const astral = '𝔸'.repeat(MAX_NEGATIVE_KEYWORD_TEXT_LENGTH);
    expect(parseNegativeKeywordInput(astral).problems).toEqual([]);
    expect(parseNegativeKeywordInput('a'.repeat(MAX_NEGATIVE_KEYWORD_TEXT_LENGTH + 1)).problems[0].reason).toContain(`${MAX_NEGATIVE_KEYWORD_TEXT_LENGTH}`);
  });

  // A caller that knows the platform passes its own, shorter cap — Google Ads' 80 against the
  // shared 100 — and a text that clears the shared limit is then still refused.
  it('applies a caller-supplied text limit instead of the shared one', () => {
    const text = 'a'.repeat(MAX_GOOGLE_NEGATIVE_KEYWORD_TEXT_LENGTH + 1);
    expect(parseNegativeKeywordInput(text).problems).toEqual([]);
    const parsed = parseNegativeKeywordInput(text, MAX_GOOGLE_NEGATIVE_KEYWORD_TEXT_LENGTH);
    expect(parsed.keywords).toEqual([]);
    expect(parsed.problems[0].reason).toContain(`${MAX_GOOGLE_NEGATIVE_KEYWORD_TEXT_LENGTH}`);
    expect(parseNegativeKeywordInput('a'.repeat(MAX_GOOGLE_NEGATIVE_KEYWORD_TEXT_LENGTH), MAX_GOOGLE_NEGATIVE_KEYWORD_TEXT_LENGTH).problems).toEqual([]);
  });

  it.each([null, undefined, 42])('treats a non-string (%s) as empty', (value) => {
    expect(parseNegativeKeywordInput(value)).toEqual({ keywords: [], problems: [] });
  });
});

describe('keywordActionKey', () => {
  it('keeps the Google key unchanged and qualifies the Microsoft one', () => {
    expect(keywordActionKey('google-ads', '11', '22')).toBe('11-22');
    expect(keywordActionKey('microsoft-ads', '11', '22')).toBe('microsoft-ads:11-22');
  });
});

describe('campaignEtagVersion', () => {
  it.each([
    ['"3"', 3],
    ['"120"', 120],
  ])('reads the version of %s', (etag, version) => {
    expect(campaignEtagVersion(etag)).toBe(version);
  });

  it.each([undefined, null, '', '3', 'W/"3"', '"3a"', '"-1"', '"1234567890123456"'])('refuses %s as not comparable', (etag) => {
    expect(campaignEtagVersion(etag as string | null | undefined)).toBeNull();
  });
});

describe('describeCampaignDispatchFailure', () => {
  // Built exactly as DispatchFailureMessage + reasonSuffix build it (internal/service/dispatch_failure.go).
  const notUsable = (provider: string, token: string) =>
    `this project's ${provider} connection cannot be used as configured (reason: ${token}); nothing was sent`;

  it.each([
    ['account_not_selected', 'meta-ads', "Ask an LFX administrator to choose an ad account on this project's Meta Ads connection, then create again."],
    ['connection_inactive', 'reddit-ads', "Ask an LFX administrator to reactivate this project's Reddit Ads connection, then create again."],
    [
      'credentials_undecodable',
      'linkedin-ads',
      "Ask an LFX administrator to reconnect this project's LinkedIn Ads connection to save fresh credentials, then create again.",
    ],
    [
      'credentials_incomplete',
      'microsoft-ads',
      "Ask an LFX administrator to reconnect this project's Microsoft Ads connection to save fresh credentials, then create again.",
    ],
    [
      'credential_blob_malformed',
      'google-ads',
      "Ask an LFX administrator to reconnect this project's Google Ads connection to save fresh credentials, then create again.",
    ],
    [
      'credentials_absent',
      'meta-ads',
      "Ask an LFX administrator to reconnect this project's Meta Ads connection to save fresh credentials, then create again.",
    ],
    ['credentials_expired', 'linkedin-ads', "Ask an LFX administrator to re-authorize this project's LinkedIn Ads connection, then create again."],
  ])('maps %s on %s to a next step and drops the raw reason fragment', (token, provider, step) => {
    const d = describeCampaignDispatchFailure(notUsable(provider, token));
    expect(d.nextStep).toBe(step);
    expect(d.message).toBe(`this project's ${provider} connection cannot be used as configured; nothing was sent`);
    expect(d.nothingCreated).toBe(true);
  });

  it('falls back to the raw platform id when the provider has no label', () => {
    expect(describeCampaignDispatchFailure(notUsable('hubspot', 'connection_inactive')).nextStep).toBe(
      "Ask an LFX administrator to reactivate this project's hubspot connection, then create again."
    );
  });

  it('leaves an unknown token verbatim with no next step', () => {
    const error = notUsable('meta-ads', 'token_request_rejected');
    expect(describeCampaignDispatchFailure(error)).toEqual({ message: error, nextStep: null, nothingCreated: true });
  });

  it('does not map an inherited object key as a token', () => {
    const error = notUsable('meta-ads', 'constructor');
    expect(describeCampaignDispatchFailure(error).nextStep).toBeNull();
  });

  it('does not map the LF system connection sentence, which the project cannot repair', () => {
    const error = 'the LF system meta-ads connection is not usable as configured (reason: account_not_selected); nothing was sent';
    expect(describeCampaignDispatchFailure(error)).toEqual({ message: error, nextStep: null, nothingCreated: true });
  });

  it('ignores a reason fragment embedded in any other text', () => {
    const error = "upstream said: this project's meta-ads connection cannot be used as configured (reason: account_not_selected); nothing was sent";
    expect(describeCampaignDispatchFailure(error).nextStep).toBeNull();
    const trailing = `${notUsable('meta-ads', 'account_not_selected')} — extra`;
    expect(describeCampaignDispatchFailure(trailing)).toEqual({ message: trailing, nextStep: null, nothingCreated: false });
  });

  it.each([
    'no meta-ads connection is configured for this project; nothing was sent',
    'the stored reddit-ads credentials could not be decrypted; nothing was sent',
    'the LF system google-ads connection is not installed; nothing was sent',
    'linkedin-ads token refresh failed, so nothing was sent; the connection may need re-authorizing',
    'meta-ads answered HTTP 503 before anything was created (a retry may succeed); nothing was created',
    'reddit-ads refused the request (HTTP 400) before anything was created; nothing was created',
    'meta-ads campaign creation was stopped before anything was sent by a defect in this service; the connection is not at fault',
  ])('flags the pre-create sentence %j as nothing created', (error) => {
    expect(describeCampaignDispatchFailure(error)).toEqual({ message: error, nextStep: null, nothingCreated: true });
  });

  it.each([
    'meta-ads campaign creation could not be confirmed; something may have been created — verify on the platform before retrying',
    'meta-ads campaign creation could not be confirmed (the platform answered HTTP 502); something may have been created — verify on the platform before retrying',
    'platform campaign creation failed',
    'skipped: another concurrent dispatch owns this platform',
    'dispatcher returned no campaign',
  ])('does not flag %j as nothing created', (error) => {
    expect(describeCampaignDispatchFailure(error)).toEqual({ message: error, nextStep: null, nothingCreated: false });
  });
});

describe('briefSlugYearCandidates (#5492)', () => {
  it('gives the slug with this year and each of the next two, in order', () => {
    expect(briefSlugYearCandidates('kubecon-cloudnativecon-europe', 2026)).toEqual([
      'kubecon-cloudnativecon-europe-2026',
      'kubecon-cloudnativecon-europe-2027',
      'kubecon-cloudnativecon-europe-2028',
    ]);
  });

  it('gives none when the slug already ends in a year, or is empty', () => {
    expect(briefSlugYearCandidates('open-source-summit-europe-2027', 2026)).toEqual([]);
    expect(briefSlugYearCandidates('', 2026)).toEqual([]);
  });

  it('still guesses when a number in the slug is not a trailing four-digit year', () => {
    expect(briefSlugYearCandidates('kubeday-26', 2026)).toEqual(['kubeday-26-2026', 'kubeday-26-2027', 'kubeday-26-2028']);
  });
});

describe('deriveSurveySlug', () => {
  // The ONE derivation the planner looks a survey up with and the BFF saves it under: two copies
  // that disagreed left a saved Google Form survey impossible to reopen.
  it("uses the promoted link's last path segment", () => {
    expect(deriveSurveySlug('https://surveys.example.com/r/Cloud_Native-2026/', 'Anything')).toBe('cloud-native-2026');
  });

  it.each([
    ['a Google Form', 'https://docs.google.com/forms/d/e/1FAIpQ/viewform'],
    ['a link with no path', 'https://surveys.example.com/?sid=5'],
  ])("names %s after the source document's title", (_label, url) => {
    expect(deriveSurveySlug(url, '\n  2026 Cloud Native Survey\nTwelve questions.')).toBe('2026-cloud-native-survey');
  });

  it('names two Microsoft Forms apart by their titles, not their shared page name', () => {
    expect(deriveSurveySlug('https://forms.office.com/Pages/ResponsePage.aspx?id=A', 'Developer Survey')).toBe('developer-survey');
    expect(deriveSurveySlug('https://forms.office.com/Pages/ResponsePage.aspx?id=B', 'Maintainer Survey')).toBe('maintainer-survey');
  });

  it('is empty when neither the link nor the text names the asset', () => {
    expect(deriveSurveySlug('https://docs.google.com/forms/d/e/1FAIpQ/viewform', '   ')).toBe('');
    expect(deriveSurveySlug('not a url', '')).toBe('');
  });
});

describe('surveySourceTitle', () => {
  it('is the first non-empty line, trimmed and capped at 120 characters', () => {
    expect(surveySourceTitle('\n   2026 Cloud Native Survey  \nTwelve questions.')).toBe('2026 Cloud Native Survey');
    expect(surveySourceTitle('x'.repeat(130))).toHaveLength(120);
    expect(surveySourceTitle('  \n ')).toBe('');
  });
});

describe('campaignSurveySourceTextLength', () => {
  it('collapses whitespace as Go strings.Fields does: U+0085 is a space, U+FEFF is not', () => {
    expect(campaignSurveySourceTextLength('a\u0085\u0085b')).toBe(3);
    expect(campaignSurveySourceTextLength('a\uFEFF\uFEFF\uFEFFb')).toBe(5);
    expect(campaignSurveySourceTextLength('\uFEFFa\u0085')).toBe(2);
  });

  it('counts as campaign-service does: whitespace runs as one space, trimmed, in code points', () => {
    expect(campaignSurveySourceTextLength('  a \n\n\t b  ')).toBe(3);
    // One emoji is one rune upstream, though two UTF-16 units here.
    expect(campaignSurveySourceTextLength('😀')).toBe(1);
  });
});

describe('campaignSurveySourceTextTooLong', () => {
  it("applies campaign-service's counted limit", () => {
    expect(campaignSurveySourceTextTooLong('x'.repeat(3000))).toBe(false);
    expect(campaignSurveySourceTextTooLong('x'.repeat(3001))).toBe(true);
  });

  it('refuses on the raw length first, before normalising or counting an oversized body', () => {
    // Collapses to one character, so only the raw ceiling can refuse it.
    expect(campaignSurveySourceTextTooLong(' '.repeat(24_001) + 'a')).toBe(true);
    expect(campaignSurveySourceTextTooLong(' '.repeat(23_999) + 'a')).toBe(false);
  });
});

describe('campaignFlightDays', () => {
  it('counts the start and end days both', () => {
    expect(campaignFlightDays('2026-10-29', '2026-11-28')).toBe(31);
  });

  it('counts a same-day flight as one day', () => {
    expect(campaignFlightDays('2026-12-01', '2026-12-01')).toBe(1);
  });

  it('counts whole days across a daylight-saving change', () => {
    // US clocks go back on 2026-11-01 and Sydney's go forward on 2026-10-04; neither may shave a day.
    expect(campaignFlightDays('2026-10-31', '2026-11-02')).toBe(3);
    expect(campaignFlightDays('2026-10-03', '2026-10-05')).toBe(3);
  });

  it('counts across a leap day', () => {
    expect(campaignFlightDays('2028-02-28', '2028-03-01')).toBe(3);
  });

  it('returns null when the end is before the start', () => {
    expect(campaignFlightDays('2026-12-10', '2026-12-01')).toBeNull();
  });

  it.each([[''], ['2026-1-01'], ['2026-02-30'], ['2026-13-01'], ['01/12/2026'], ['2026-12-01T00:00:00Z']])('returns null for the date %j', (bad) => {
    expect(campaignFlightDays(bad, '2026-12-31')).toBeNull();
    expect(campaignFlightDays('2026-01-01', bad)).toBeNull();
  });
});

describe('isReversedCampaignFlight', () => {
  it('is true for an end before the start', () => {
    expect(isReversedCampaignFlight('2026-12-10', '2026-12-09')).toBe(true);
    expect(isReversedCampaignFlight('2027-01-01', '2026-12-31')).toBe(true);
  });

  it('is false for a same-day flight, which Google accepts', () => {
    expect(isReversedCampaignFlight('2026-12-10', '2026-12-10')).toBe(false);
  });

  it('is false for a forward flight', () => {
    expect(isReversedCampaignFlight('2026-12-10', '2026-12-11')).toBe(false);
  });

  it.each([[''], ['2026-1-01'], ['2026-02-30'], ['not a date']])('is false when a date is not a real calendar day (%j)', (bad) => {
    expect(isReversedCampaignFlight(bad, '2026-01-01')).toBe(false);
    expect(isReversedCampaignFlight('2026-12-31', bad)).toBe(false);
  });
});

describe('dailyBudgetFromTotal', () => {
  it('divides the total over the days, rounded down to the cent', () => {
    expect(dailyBudgetFromTotal(900, 31)).toBe(29.03);
    expect(dailyBudgetFromTotal(5000, 30)).toBe(166.66);
  });

  it('never spends more than the total over the flight', () => {
    for (const [total, days] of [
      [900, 31],
      [5000, 30],
      [1234.56, 7],
      [0.07, 7],
      [100, 3],
    ]) {
      const daily = dailyBudgetFromTotal(total, days) as number;
      expect(Math.round(daily * days * 100)).toBeLessThanOrEqual(Math.round(total * 100));
    }
  });

  it('keeps an exact division exact', () => {
    expect(dailyBudgetFromTotal(3100, 31)).toBe(100);
    expect(dailyBudgetFromTotal(500, 1)).toBe(500);
  });

  it('steps back a cent when a total holding a fraction of a cent would round up past itself', () => {
    // Rounding 31.309 to the cent gives 31.31, which divides to 1.01 a day and 31.31 over the flight.
    expect(dailyBudgetFromTotal(31.309, 31)).toBe(1);
    expect(dailyBudgetFromTotal(31.304, 31)).toBe(1);
    expect((dailyBudgetFromTotal(31.309, 31) as number) * 31).toBeLessThanOrEqual(31.309);
  });

  it('can return less than one when the total is small for the flight', () => {
    expect(dailyBudgetFromTotal(10, 31)).toBe(0.32);
  });

  it.each([
    [0, 31],
    [-100, 31],
    [Number.NaN, 31],
    [Number.POSITIVE_INFINITY, 31],
    [900, 0],
    [900, 2.5],
    [900, -1],
  ])('returns null for a total of %d over %d day(s)', (total, days) => {
    expect(dailyBudgetFromTotal(total, days)).toBeNull();
  });
});

/** #4983 ("ss-4"): the labels that tell a brief's campaigns on one platform apart, "—" when absent. */
describe('campaignLabelColumns', () => {
  it('names the Google channel, stage, tactic and created date a labelled campaign records', () => {
    const labels = campaignLabelColumns(
      {
        platform: 'google-ads',
        variant: 'demand-gen',
        funnel_stage: 'mid',
        tactic: 'content-promotion',
        created_at: '2026-11-02T12:00:00Z',
      },
      'UTC'
    );
    expect(labels).toEqual({ channel: 'Demand Gen', stage: 'Mid funnel', tactic: 'Content promotion', created: 'Nov 2, 2026' });
  });

  it("leaves the created date to the browser when the viewer's zone is not known (a server render)", () => {
    expect(campaignLabelColumns({ platform: 'google-ads', created_at: '2026-11-02T12:00:00Z' }, null).created).toBe('—');
  });

  it('dates a campaign by the calendar day in the zone it is given', () => {
    const lateEvening = { platform: 'google-ads', created_at: '2026-11-03T03:00:00Z' };
    expect(campaignLabelColumns(lateEvening, 'UTC').created).toBe('Nov 3, 2026');
    expect(campaignLabelColumns(lateEvening, 'America/Los_Angeles').created).toBe('Nov 2, 2026');
  });

  it("reads Google's default variant as Search, and names no channel on a single-channel platform", () => {
    expect(campaignLabelColumns({ platform: 'google-ads', variant: 'default' }).channel).toBe('Search');
    expect(campaignLabelColumns({ platform: 'microsoft-ads', variant: 'default' }).channel).toBe('—');
  });

  it('shows "—" for every label a legacy campaign does not record', () => {
    expect(campaignLabelColumns({ platform: 'google-ads' })).toEqual({ channel: '—', stage: '—', tactic: '—', created: '—' });
  });

  it('shows "—", never raw text or "Invalid Date", for values this build does not know', () => {
    const labels = campaignLabelColumns({
      platform: 'google-ads',
      variant: 'shopping',
      // @ts-expect-error an unknown stage, as the unvalidated index can carry
      funnel_stage: 'toString',
      // @ts-expect-error an unknown tactic, as the unvalidated index can carry
      tactic: '<b>other</b>',
      created_at: 'yesterday',
    });
    expect(labels).toEqual({ channel: '—', stage: '—', tactic: '—', created: '—' });
  });
});

describe('campaignEventStartDate (#1614)', () => {
  it.each([
    ['2027-03-15', '2027-03-15'],
    ['March 15, 2027', '2027-03-15'],
    ['Mar. 15th, 2027', '2027-03-15'],
    ['Monday, March 15, 2027', '2027-03-15'],
    ['March 23-26, 2027', '2027-03-23'],
    ['March 30 \u2013 April 1, 2027', '2027-03-30'],
    ['15 March 2027', '2027-03-15'],
    ['23\u201326 March 2027', '2027-03-23'],
    ['30 March - 1 April 2027', '2027-03-30'],
    // Both shapes match here; the earlier one is the start.
    ['30 March \u2013 April 1, 2027', '2027-03-30'],
    ['December 30, 2026 - January 2, 2027', '2026-12-30'],
    // The year written once, for the end of a range that crosses New Year.
    ['December 30 \u2013 January 2, 2027', '2026-12-30'],
    ['30 December - 2 January 2027', '2026-12-30'],
    ['December 28-31, 2026', '2026-12-28'],
    // The one year written after the START is the start's, not the end's (PR #5387 review).
    ['December 30, 2026 - January 2', '2026-12-30'],
    ['30 December 2026 - 2 January', '2026-12-30'],
    // A word that only starts like a month is not one (PR #5387 review): read as a later, lower month
    // ahead of the year, each of these would move the start a year back.
    ['December 3 at the Marriott Marquis, 2028', '2028-12-03'],
    ['December 2, Rio de Janeiro 2028', '2028-12-02'],
    ['November 5 at Junction City, 2028', '2028-11-05'],
    ['March 3 in Decatur, 2028', '2028-03-03'],
    ['September 10, 2028 at the Marriott Marquis', '2028-09-10'],
    ['September 1 2027', '2027-09-01'],
  ])('reads %s as %s', (dates, expected) => {
    expect(campaignEventStartDate(dates)).toBe(expected);
  });

  it.each([
    ['no year', 'March 15'],
    ['no month', '15 2027'],
    ['an impossible day', 'February 30, 2027'],
    ['an impossible ISO date', '2027-02-30'],
    ['a month and year only', 'March 2027'],
    ['blank', ''],
    ['a duration', 'Self-paced, 40 hours'],
  ])('is null for %s', (_label, dates) => {
    expect(campaignEventStartDate(dates)).toBeNull();
  });

  it('is null for a missing value', () => {
    expect(campaignEventStartDate(undefined)).toBeNull();
    expect(campaignEventStartDate(null)).toBeNull();
  });
});

describe('defaultCampaignEndDate (#1614)', () => {
  const today = '2026-11-07';
  const fallback = '2026-12-07';

  it('ends on the event day when it is after today, even past the fallback', () => {
    expect(defaultCampaignEndDate('March 15, 2027', today, fallback)).toBe('2027-03-15');
  });

  it('ends on the event day when it is before the fallback', () => {
    expect(defaultCampaignEndDate('November 20, 2026', today, fallback)).toBe('2026-11-20');
  });

  it('keeps the fallback for an event today, since every other platform refuses an end that is not after the start', () => {
    expect(defaultCampaignEndDate('November 7, 2026', today, fallback)).toBe(fallback);
  });

  it('keeps the fallback for a past event or unreadable dates', () => {
    expect(defaultCampaignEndDate('March 15, 2026', today, fallback)).toBe(fallback);
    expect(defaultCampaignEndDate('Self-paced', today, fallback)).toBe(fallback);
    expect(defaultCampaignEndDate(undefined, today, fallback)).toBe(fallback);
  });

  it('divides the brief total over the same flight it ends', () => {
    const end = defaultCampaignEndDate('March 15, 2027', today, fallback);
    expect(campaignFlightDays(today, end)).toBe(129);
    expect(dailyBudgetFromTotal(1000, campaignFlightDays(today, end) as number)).toBe(7.75);
  });
});

describe('googleAdsCampaignUrl (#1614)', () => {
  it('links to the campaign in the Google Ads UI', () => {
    expect(googleAdsCampaignUrl('24447438160')).toBe('https://ads.google.com/aw/campaigns?campaignId=24447438160');
  });

  it('is empty without an id', () => {
    expect(googleAdsCampaignUrl('')).toBe('');
    expect(googleAdsCampaignUrl(undefined)).toBe('');
  });

  it('percent-encodes the id', () => {
    expect(googleAdsCampaignUrl('1&x=2')).toBe('https://ads.google.com/aw/campaigns?campaignId=1%26x%3D2');
  });
});

describe('googleSeededFlight (#4847, #1614)', () => {
  const today = '2026-11-07';

  it('divides the total over the flight when that is at least the floor, either way', () => {
    expect(googleSeededFlight(1000, today, '2026-12-07', true)).toEqual({ endDate: '2026-12-07', dailyBudget: 32.25 });
    expect(googleSeededFlight(1000, today, '2026-12-07', false)).toEqual({ endDate: '2026-12-07', dailyBudget: 32.25 });
  });

  it('shortens a Google-only flight to the days the total funds at the floor, never seeding under it', () => {
    // 100 over the 129 days to 15 March is 0.77 a day; 100 days at 1 a day ends 14 February.
    expect(googleSeededFlight(100, today, '2027-03-15', true)).toEqual({ endDate: '2027-02-14', dailyBudget: 1 });
  });

  it('gives a total under two days at the floor the shortest flight the platforms accept, not the whole run-up', () => {
    // PR #5389 review: 1.5 kept the 129-day flight at 1 a day, about 129 against a plan of 1.5.
    expect(googleSeededFlight(1.5, today, '2027-03-15', true)).toEqual({ endDate: '2026-11-08', dailyBudget: 1 });
  });

  it('keeps an end date shared with other platforms and seeds the floor (PR #5389 review)', () => {
    expect(googleSeededFlight(100, today, '2027-03-15', false)).toEqual({ endDate: '2027-03-15', dailyBudget: 1 });
    expect(googleSeededFlight(1.5, today, '2027-03-15', false)).toEqual({ endDate: '2027-03-15', dailyBudget: 1 });
  });

  it('seeds no budget without a usable total', () => {
    expect(googleSeededFlight(null, today, '2027-03-15', true)).toEqual({ endDate: '2027-03-15', dailyBudget: null });
    expect(googleSeededFlight(0, today, '2027-03-15', true)).toEqual({ endDate: '2027-03-15', dailyBudget: null });
  });
});
