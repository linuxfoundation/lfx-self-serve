// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EVENT_TERM_DISTINCTIVE_LENGTH, EVENT_TERM_GENERIC, EVENT_TERM_YEAR_PATTERN } from '../constants/campaign.constants';
import {
  EMAIL_TEMPLATE_DRAFT_CLONE_PATTERN,
  EMAIL_TEMPLATE_EDITION_LEAD_MS,
  EMAIL_TEMPLATE_EDITION_TRAIL_MS,
  EMAIL_TEMPLATE_EXCLUDED_STATE_PARTS,
  EMAIL_TEMPLATE_GENERIC_WORDS,
  EMAIL_TEMPLATE_NEWSLETTER_PATTERN,
  EMAIL_TEMPLATE_PROSE_ABBREVIATIONS,
  EMAIL_TEMPLATE_REGION_ABBREVIATIONS,
  EMAIL_TEMPLATE_REGION_PHRASES,
  EMAIL_TEMPLATE_SCOPE_MAX_PHRASES,
  EMAIL_TEMPLATE_SENT_STATE_PREFIXES,
  EMAIL_TEMPLATE_STAGED_DRAFT_PATTERN,
  EMAIL_TEMPLATE_TEST_NAME_PATTERN,
  EVENT_DATE_MONTH_NAMES,
} from '../constants/campaign-email-template.constants';
import { COUNTRIES } from '../constants/countries.constants';
import type { CampaignEmailTemplateFit, CampaignEmailTemplateScope, CampaignEventDetails, HubSpotMarketingEmail } from '../interfaces/campaign.interface';

/**
 * Normalises text for whole-word matching, exactly as campaign-service's `normalizePhrase` does:
 * lower-case, and every run of characters that are not letters or digits collapsed to one space.
 * Both sides of every comparison go through this, so "KubeCon+CloudNativeCon" and
 * "kubecon cloudnativecon" compare equal and "KubeConference" never contains "kubecon".
 */
export function normalizeTemplateText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part !== '')
    .join(' ');
}

/** Whether `phrase` (normalised) appears in `text` (normalised) as whole words. */
export function containsTemplatePhrase(normalizedText: string, normalizedPhrase: string): boolean {
  if (normalizedPhrase === '' || normalizedText === '') {
    return false;
  }
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

/**
 * Reads the brand and the edition out of an event's details, for the template picker.
 *
 * The brand is the event name with its edition removed: region ("North America"), country
 * ("Japan"), city ("Nairobi") and year. The name is split on its separators first, so a co-branded
 * event yields one phrase per brand — "Open Source Summit Japan + AutoLinux + Embedded Linux 2026"
 * gives `open source summit`, `autolinux`, `embedded linux`, which is what finds its templates when
 * they are named "OS Summit Japan + AutoLinux + ...". A segment made only of generic words is
 * dropped, because "summit" alone would match every summit in the portal.
 *
 * The edition's first day comes from the free-text dates when they name one (see
 * `parseEventStartDate`), so a template can be dated against it.
 *
 * Null when the details name no usable brand: the picker then lists the portal as it always has.
 */
export function deriveEmailTemplateScope(
  details: (Pick<CampaignEventDetails, 'name' | 'slug' | 'city' | 'countryCode'> & Partial<Pick<CampaignEventDetails, 'dates'>>) | null | undefined
): CampaignEmailTemplateScope | null {
  if (!details) {
    return null;
  }
  const source = (details.name ?? '').trim() || (details.slug ?? '').replace(/[-_]+/g, ' ').trim();
  if (source === '') {
    return null;
  }

  const editionPhrases = editionPhrasesFor(details);
  const phrases: string[] = [];
  const labels: string[] = [];
  const editionWords: string[] = [];
  const removedEdition = new Set<string>();
  let year = '';

  // Split on the separators events use between brands: "+", "&", "|", "/", ":", dashes and commas.
  // No `\s*` around the separators: overlapping with the spaced dash it made the pattern polynomial
  // on long runs of whitespace (CodeQL js/polynomial-redos). Each segment is trimmed instead.
  for (const segment of source.split(/[+&|/:,]|\s[–—-]\s/u).map((part) => part.trim())) {
    const words = segment.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');
    if (words.length === 0) {
      continue;
    }
    // Remove the edition: every region, country or city phrase, wherever it sits, and the year.
    const keep: string[] = [];
    let i = 0;
    while (i < words.length) {
      if (EVENT_TERM_YEAR_PATTERN.test(words[i])) {
        year = year === '' ? words[i] : year;
        i++;
        continue;
      }
      const phrase = longestEditionPhraseAt(words, i, editionPhrases);
      if (phrase > 0) {
        const removed = words.slice(i, i + phrase);
        removedEdition.add(normalizeTemplateText(removed.join(' ')));
        editionWords.push(...removed);
        i += phrase;
        continue;
      }
      keep.push(words[i]);
      i++;
    }
    const normalized = normalizeTemplateText(keep.join(' '));
    if (normalized === '' || isGenericPhrase(normalized)) {
      continue;
    }
    // A name written without its separators -- "Kubecon Cloudnativecon Europe 2028", as a brief
    // read back from a slug has it -- leaves several brands run together in one segment, and as one
    // phrase it finds only templates that name them side by side, missing "KubeCon Europe | Last
    // Chance". When EVERY word is distinctive on its own, each is searched for separately. Phrases
    // with an ordinary word ("Open Source Summit", "Embedded Linux") stay whole: their words alone
    // would match half the portal.
    const brandWords = normalized.split(' ');
    const searchable = brandWords.length > 1 && brandWords.every(isDistinctiveWord) ? brandWords : [normalized];
    for (const phrase of searchable) {
      if (!phrases.includes(phrase)) {
        phrases.push(phrase);
      }
    }
    labels.push(keep.join(' '));
  }

  if (phrases.length === 0) {
    return null;
  }

  // The edition terms: what was removed from the name, the city and country even when the name
  // does not mention them, and the abbreviations templates use for each region.
  const editionTerms = new Set<string>(removedEdition);
  const city = normalizeTemplateText(details.city);
  if (city !== '') {
    editionTerms.add(city);
  }
  const country = countryLabel(details.countryCode);
  if (country !== '') {
    editionTerms.add(normalizeTemplateText(country));
  }
  // Both ways: a full name brings its abbreviations ("north america" -> "na"), and an abbreviation
  // brings its full name and that name's other abbreviations ("na" -> "north america"), so an event
  // named "... NA 2026" still recognises the "... North America 2026" templates.
  for (const term of [...editionTerms]) {
    for (const [full, abbreviations] of Object.entries(EMAIL_TEMPLATE_REGION_ABBREVIATIONS)) {
      if (term === full || abbreviations.includes(term)) {
        editionTerms.add(full);
        for (const abbreviation of abbreviations) {
          editionTerms.add(abbreviation);
        }
      }
    }
  }

  const editionLabel = [...dedupeWords(editionWords), year].filter((w) => w !== '').join(' ');
  return {
    label: labels.join(' + '),
    editionLabel,
    phrases: phrases.slice(0, EMAIL_TEMPLATE_SCOPE_MAX_PHRASES),
    editionTerms: [...editionTerms].filter((t) => t !== ''),
    year,
    editionStart: parseEventStartDate(details.dates, year),
  };
}

/**
 * The first day an event's free-text dates name, as `YYYY-MM-DD`; '' when they name no day.
 *
 * Reads the forms event pages use: "19-20 November 2026", "April 24-27, 2028", "March 30 - April 2,
 * 2027" and "2028-04-24". The first month word and the first day number are the start; the year is
 * the first four-digit year in the text, else `fallbackYear` (the year in the event's name).
 */
export function parseEventStartDate(dates: string | null | undefined, fallbackYear = ''): string {
  const text = (dates ?? '').trim();
  if (text === '') {
    return '';
  }
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const year = Number(text.match(/\b(20\d{2})\b/)?.[1] ?? fallbackYear) || 0;
  let month = 0;
  let day = 0;
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (month === 0 && monthOf(word) > 0) {
      month = monthOf(word);
    } else if (day === 0 && /^\d{1,2}$/.test(word) && Number(word) >= 1 && Number(word) <= 31) {
      day = Number(word);
    }
  }
  if (year === 0 || month === 0 || day === 0) {
    return '';
  }
  return isoDate(year, month, day);
}

/**
 * Where a template sits relative to the event: this edition's, the brand's other editions', or not
 * a template for this send at all.
 *
 * Excluded: automated (workflow) emails, the B half of an A/B pair, this app's own staged drafts,
 * test emails, newsletters, draft copies, and anything that does not carry the brand.
 *
 * This edition: the template names the edition (a region, country, city or their abbreviations)
 * and no OTHER year — "KubeCon + CloudNativeCon NA 2025" is the previous North America edition, not
 * this one — and, unless it names this edition's year, it was last edited while this edition's
 * sends were being written. When nothing names an edition, the year and the edit date decide.
 */
export function classifyEmailTemplate(template: HubSpotMarketingEmail, scope: CampaignEmailTemplateScope): CampaignEmailTemplateFit {
  if (isExcludedTemplate(template)) {
    return 'excluded';
  }
  const name = normalizeTemplateText(template.name);
  const subject = normalizeTemplateText(template.subject);
  const inBrand = scope.phrases.some((phrase) => containsTemplatePhrase(name, phrase) || containsTemplatePhrase(subject, phrase));
  if (!inBrand) {
    return 'excluded';
  }

  const text = `${name} ${subject}`.trim();
  const years = new Set(text.split(' ').filter((word) => EVENT_TERM_YEAR_PATTERN.test(word)));
  const otherYear = scope.year !== '' && years.size > 0 && !years.has(scope.year);
  if (otherYear) {
    return 'other-edition';
  }
  // An annual event's emails often carry no year at all ("2 Weeks Until KubeCon + CloudNativeCon
  // Europe Takes Over Amsterdam" is the 2026 edition), so the region alone would call every past
  // Europe send this edition's. The edit date bounds them instead -- unless the template names this
  // edition's year, which says more than when it was last touched.
  const namesThisYear = scope.year !== '' && years.has(scope.year);
  if (!namesThisYear && editedOutsideEdition(template.updatedAt, scope)) {
    return 'other-edition';
  }
  if (scope.editionTerms.length > 0) {
    return namesEditionPlace(template, scope) ? 'this-edition' : 'other-edition';
  }
  return scope.year === '' || years.has(scope.year) ? 'this-edition' : 'other-edition';
}

/**
 * Whether a template names this edition's place -- its region, country, city or their
 * abbreviations -- whatever its year. Last year's "KubeCon + CloudNativeCon Europe" sends name the
 * place of a Europe 2028 brief; the brand's India and North America series do not.
 */
export function namesEditionPlace(template: HubSpotMarketingEmail, scope: CampaignEmailTemplateScope): boolean {
  const text = `${normalizeTemplateText(template.name)} ${normalizeTemplateText(template.subject)}`.trim();
  const raw = `${template.name ?? ''} ${template.subject ?? ''}`;
  return scope.editionTerms.some((term) =>
    EMAIL_TEMPLATE_PROSE_ABBREVIATIONS.has(term) ? namesAbbreviationInCapitals(raw, term) : containsTemplatePhrase(text, term)
  );
}

/** Whether `raw` carries `abbreviation` as a whole word in capitals ("US", not the pronoun "us"). */
function namesAbbreviationInCapitals(raw: string, abbreviation: string): boolean {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${abbreviation.toUpperCase()}(?=$|[^\\p{L}\\p{N}])`, 'u').test(raw);
}

/** Whether a template went out (or is booked to), which makes it a proven design to clone. */
export function isSentEmailTemplate(template: HubSpotMarketingEmail): boolean {
  const state = (template.state ?? '').toUpperCase();
  return EMAIL_TEMPLATE_SENT_STATE_PREFIXES.some((prefix) => state.startsWith(prefix));
}

/** Rows that are never a clone source for a new event send, whatever their brand. */
function isExcludedTemplate(template: HubSpotMarketingEmail): boolean {
  const state = (template.state ?? '').toUpperCase();
  if (EMAIL_TEMPLATE_EXCLUDED_STATE_PARTS.some((part) => state.includes(part))) {
    return true;
  }
  const name = template.name ?? '';
  if (EMAIL_TEMPLATE_STAGED_DRAFT_PATTERN.test(name) || EMAIL_TEMPLATE_TEST_NAME_PATTERN.test(name) || EMAIL_TEMPLATE_NEWSLETTER_PATTERN.test(name)) {
    return true;
  }
  return state === 'DRAFT' && EMAIL_TEMPLATE_DRAFT_CLONE_PATTERN.test(name);
}

/**
 * Whether a template was last edited outside the window its edition's sends are written in.
 *
 * With the edition's first day: from `EMAIL_TEMPLATE_EDITION_LEAD_MS` before it to
 * `EMAIL_TEMPLATE_EDITION_TRAIL_MS` after. With only the year: from the start of the year before to
 * the end of the year after, which no edition's promotion and follow-ups outrun. A template without
 * an edit date, or an edition with neither, is never judged on it.
 */
function editedOutsideEdition(updatedAt: string | undefined, scope: CampaignEmailTemplateScope): boolean {
  const edited = Date.parse(updatedAt ?? '');
  if (Number.isNaN(edited)) {
    return false;
  }
  const start = Date.parse(scope.editionStart);
  if (!Number.isNaN(start)) {
    return edited < start - EMAIL_TEMPLATE_EDITION_LEAD_MS || edited > start + EMAIL_TEMPLATE_EDITION_TRAIL_MS;
  }
  const year = Number(scope.year);
  if (!year) {
    return false;
  }
  return edited < Date.UTC(year - 1, 0, 1) || edited >= Date.UTC(year + 2, 0, 1);
}

/** The month (1-12) a word names, or 0: three letters or more that start a month's name. */
function monthOf(word: string): number {
  if (word.length < 3 || /\d/.test(word)) {
    return 0;
  }
  return EVENT_DATE_MONTH_NAMES.findIndex((name) => name.startsWith(word)) + 1;
}

/** `YYYY-MM-DD` for a real calendar day, or '' (31 April is not one). */
function isoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

/** Every phrase that names an edition of this event, normalised and split into words. */
function editionPhrasesFor(details: Pick<CampaignEventDetails, 'city' | 'countryCode'>): string[][] {
  const phrases = new Set<string>(EMAIL_TEMPLATE_REGION_PHRASES);
  // The abbreviations name an edition too: an event scraped as "KubeCon + CloudNativeCon NA 2026"
  // must still yield the brand "cloudnativecon", not "cloudnativecon na".
  for (const abbreviations of Object.values(EMAIL_TEMPLATE_REGION_ABBREVIATIONS)) {
    for (const abbreviation of abbreviations) {
      phrases.add(abbreviation);
    }
  }
  const city = normalizeTemplateText(details.city);
  if (city !== '') {
    phrases.add(city);
  }
  const country = normalizeTemplateText(countryLabel(details.countryCode));
  if (country !== '') {
    phrases.add(country);
    // "South Korea" is "Korea" in event names.
    for (const abbreviation of EMAIL_TEMPLATE_REGION_ABBREVIATIONS[country] ?? []) {
      phrases.add(abbreviation);
    }
  }
  // Every country a name can carry, not only this event's: a scrape can miss the country code,
  // and "Open Source Summit Japan" must still lose "Japan". Single-word labels only — multi-word
  // labels ("United States") are covered through the event's own country code.
  for (const entry of COUNTRIES) {
    const label = normalizeTemplateText(entry.label);
    if (label !== '' && !label.includes(' ')) {
      phrases.add(label);
    }
  }
  // Longest first, so "latin america" wins over "america" at the same position.
  return [...phrases].map((p) => p.split(' ')).sort((a, b) => b.length - a.length);
}

/** Length, in words, of the longest edition phrase starting at `index`; 0 when none does. */
function longestEditionPhraseAt(words: readonly string[], index: number, phrases: readonly string[][]): number {
  for (const phrase of phrases) {
    if (index + phrase.length > words.length) {
      continue;
    }
    let matches = true;
    for (let k = 0; k < phrase.length; k++) {
      if (normalizeTemplateText(words[index + k]) !== phrase[k]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return phrase.length;
    }
  }
  return 0;
}

/**
 * Whether a phrase is too generic to search for. One or two generic words ("Summit", "Open Source")
 * match every summit in the portal; three or more are specific as a whole phrase, so "Open Source
 * Summit" stays a brand even though each of its words is generic on its own.
 */
function isGenericPhrase(normalized: string): boolean {
  const words = normalized.split(' ');
  if (words.length === 1 && words[0].length < 3) {
    return true;
  }
  return words.length <= 2 && words.every((word) => EMAIL_TEMPLATE_GENERIC_WORDS.has(word) || EVENT_TERM_YEAR_PATTERN.test(word));
}

/** A word that identifies a brand on its own: long enough, and not one every event name uses. */
function isDistinctiveWord(word: string): boolean {
  return word.length >= EVENT_TERM_DISTINCTIVE_LENGTH && !EMAIL_TEMPLATE_GENERIC_WORDS.has(word) && !EVENT_TERM_GENERIC.has(word);
}

function countryLabel(code: string | null | undefined): string {
  const upper = (code ?? '').trim().toUpperCase();
  if (upper === '') {
    return '';
  }
  return COUNTRIES.find((entry) => entry.value === upper)?.label ?? '';
}

function dedupeWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(word);
    }
  }
  return out;
}
