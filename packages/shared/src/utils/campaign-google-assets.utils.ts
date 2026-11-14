// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_ADS_ASSET_DATE_PATTERN,
  GOOGLE_ADS_ASSET_LANGUAGE_PATTERN,
  GOOGLE_ADS_CURRENCY_CODE_PATTERN,
  GOOGLE_ADS_ENUM_NAME_PATTERN,
  GOOGLE_ADS_MAX_ASSET_AMOUNT,
  GOOGLE_ADS_MAX_FINAL_URL_BYTES,
  GOOGLE_ADS_MAX_PHONE_NUMBER_RUNES,
  GOOGLE_ADS_MAX_PRICE_DESCRIPTION_RUNES,
  GOOGLE_ADS_MAX_PRICE_HEADER_RUNES,
  GOOGLE_ADS_MAX_PRICE_OFFERINGS,
  GOOGLE_ADS_MAX_PROMOTION_CODE_RUNES,
  GOOGLE_ADS_MAX_PROMOTION_TARGET_RUNES,
  GOOGLE_ADS_MICROS_PER_UNIT,
  GOOGLE_ADS_MIN_PHONE_DIGITS,
  GOOGLE_ADS_MIN_PRICE_OFFERINGS,
  GOOGLE_ADS_PERCENT_OFF_SCALE,
  GOOGLE_ADS_PHONE_NUMBER_PATTERN,
  googleAdsEchoed,
  googleAdsToLower,
  isGoogleAdsServableUrl,
} from '../constants/campaign.constants';
import type { CampaignCallExtension, CampaignPriceExtension, CampaignPromotion } from '../interfaces/campaign.interface';

/**
 * Google call, promotion and price extensions: the client-side mirror of the checks
 * campaign-service runs on them before the budget mutate (`internal/platform/googleads/
 * assets_extended.go`'s `validateCallExtensions`, `validatePromotionExtensions` and
 * `validatePriceExtensions`).
 *
 * ONE copy for both tiers, for the reason {@link isGoogleAdsServableUrl} gives: the Implementation
 * tab's add guard and the BFF's dispatch refusal must judge the same accept set, and two hand-written
 * copies is how one of them drifts. Each function returns the refusal as a sentence, or `null` when
 * upstream would accept the entry; the BFF wraps it with the entry's index, the tab shows it as is.
 *
 * Every function takes an entry that is ALREADY NORMALISED the way upstream normalises it — every
 * string trimmed with {@link googleAdsTrimSpace}, and country and currency codes passed through
 * {@link googleAdsToUpperCode} — so the value judged is the value sent. The list cap is the caller's,
 * because upstream checks it on the raw slice before any entry.
 *
 * The final-URL byte bound is measured UNTAGGED, the same documented under-refusal
 * {@link GOOGLE_ADS_MAX_FINAL_URL_BYTES} records for sitelinks.
 */

/**
 * Go's `strings.ToUpper` as upstream applies it to a country or currency code, for the only result
 * that can then pass the ASCII-letter check: ASCII letters are upper-cased, and so are the two
 * non-ASCII letters Go upper-cases INTO ASCII — `ı` (dotless i) to `I` and `ſ` (long s) to `S`.
 *
 * Not `toUpperCase`, which disagrees in the other direction: it expands `ß` to `SS`, so a code JS
 * accepted would be one Go refuses.
 */
export function googleAdsToUpperCode(code: string): string {
  return code.replace(/[a-zıſ]/g, (ch) => {
    if (ch === 'ı') return 'I';
    if (ch === 'ſ') return 'S';
    return ch.toUpperCase();
  });
}

/** The key upstream's call-extension duplicate check uses: the country, then the number's digits alone. */
export function googleCallExtensionKey(call: CampaignCallExtension): string {
  return `${call.countryCode}|${call.phoneNumber.replace(/[^0-9]/g, '')}`;
}

/**
 * Why upstream would refuse this call extension, or `null` when it would not.
 *
 * `validateCallExtensions`' per-entry branches in order: country blank, not ISO alpha-2, number
 * blank, over {@link GOOGLE_ADS_MAX_PHONE_NUMBER_RUNES} runes, a character outside
 * {@link GOOGLE_ADS_PHONE_NUMBER_PATTERN}, fewer than {@link GOOGLE_ADS_MIN_PHONE_DIGITS} digits, then
 * a repeat of an `earlier` entry on {@link googleCallExtensionKey} — so `+1 (415) 555-0100` and
 * `14155550100` in the same country are the same extension, as Google would render them.
 */
export function googleCallExtensionRefusal(call: CampaignCallExtension, earlier: readonly CampaignCallExtension[]): string | null {
  const { countryCode, phoneNumber } = call;
  if (countryCode === '') return 'It has no country code — Google cannot interpret a phone number without one.';
  if (!/^[A-Z]{2}$/.test(countryCode)) return `The country code ${googleAdsEchoed(countryCode)} must be a two-letter ISO code such as US or DE.`;
  if (phoneNumber === '') return 'It has no phone number.';
  const runes = [...phoneNumber].length;
  if (runes > GOOGLE_ADS_MAX_PHONE_NUMBER_RUNES) return `The phone number is ${runes} characters — the limit is ${GOOGLE_ADS_MAX_PHONE_NUMBER_RUNES}.`;
  if (!GOOGLE_ADS_PHONE_NUMBER_PATTERN.test(phoneNumber)) {
    return 'The phone number may contain only digits, spaces and + - ( ) . — Google refuses vanity numbers.';
  }
  if (phoneNumber.replace(/[^0-9]/g, '').length < GOOGLE_ADS_MIN_PHONE_DIGITS) return `The phone number has fewer than ${GOOGLE_ADS_MIN_PHONE_DIGITS} digits.`;
  const key = googleCallExtensionKey(call);
  if (earlier.some((other) => googleCallExtensionKey(other) === key)) return `The number ${googleAdsEchoed(phoneNumber)} (${countryCode}) is already listed.`;
  return null;
}

/**
 * Why upstream would refuse this promotion, or `null` when it would not.
 *
 * `validatePromotionExtensions`' branches in order: target blank, over
 * {@link GOOGLE_ADS_MAX_PROMOTION_TARGET_RUNES} runes, a case-folded repeat of an `earlier` target;
 * then the discount oneof (both, a bad percentage or money amount, neither); then the eligibility
 * oneof (both, a code over {@link GOOGLE_ADS_MAX_PROMOTION_CODE_RUNES} runes, a bad minimum order);
 * the occasion's and language's shapes; the serving window, then the redemption window; and finally
 * the destination.
 *
 * An unset number is `undefined` OR `0`, because upstream's own test is `!= 0` — a `0` on the wire
 * and an absent key decode to the same float.
 */
export function googlePromotionRefusal(promotion: CampaignPromotion, earlier: readonly CampaignPromotion[]): string | null {
  const target = promotion.promotionTarget;
  if (target === '') return 'It has no promotion target — Google needs to know what is on sale.';
  const shown = googleAdsEchoed(target);
  const runes = [...target].length;
  if (runes > GOOGLE_ADS_MAX_PROMOTION_TARGET_RUNES)
    return `The promotion target ${shown} is ${runes} characters — the limit is ${GOOGLE_ADS_MAX_PROMOTION_TARGET_RUNES}.`;
  const key = googleAdsToLower(target);
  if (earlier.some((other) => googleAdsToLower(other.promotionTarget) === key)) return `The promotion target ${shown} is already listed.`;

  const percent = promotion.discountPercent ?? 0;
  const amount = promotion.discountAmount ?? 0;
  const currency = promotion.currencyCode ?? '';
  if (percent !== 0 && amount !== 0) return 'It sets both a percentage and a money discount — Google takes exactly one.';
  if (percent !== 0) {
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return 'The discount percentage must be greater than 0 and at most 100.';
    // Rounded rather than truncated, as upstream rounds: 12.3 * 10000 is 122999.99… in float64.
    if (Math.round(percent * GOOGLE_ADS_PERCENT_OFF_SCALE) <= 0) return `The discount percentage ${percent} is too small to express.`;
  } else if (amount !== 0) {
    const refusal = googleAdsMoneyRefusal('discount amount', amount, currency);
    if (refusal) return refusal;
  } else {
    return 'It sets neither a percentage nor a money discount — one of the two is what makes it a promotion.';
  }

  const code = promotion.promotionCode ?? '';
  const ordersOver = promotion.ordersOverAmount ?? 0;
  if (code !== '' && ordersOver !== 0) return 'It sets both a promotion code and a minimum order amount — Google takes at most one.';
  if (code !== '') {
    const codeRunes = [...code].length;
    if (codeRunes > GOOGLE_ADS_MAX_PROMOTION_CODE_RUNES)
      return `The promotion code is ${codeRunes} characters — the limit is ${GOOGLE_ADS_MAX_PROMOTION_CODE_RUNES}.`;
  } else if (ordersOver !== 0) {
    const refusal = googleAdsMoneyRefusal('minimum order amount', ordersOver, currency);
    if (refusal) return refusal;
  }

  const occasion = promotion.occasion ?? '';
  if (occasion !== '' && !GOOGLE_ADS_ENUM_NAME_PATTERN.test(occasion)) {
    return `The occasion ${googleAdsEchoed(occasion)} is not an occasion name — Google spells these in upper case with underscores, such as BLACK_FRIDAY.`;
  }
  const language = promotion.languageCode ?? '';
  if (language !== '' && !GOOGLE_ADS_ASSET_LANGUAGE_PATTERN.test(language)) {
    return `The language code ${googleAdsEchoed(language)} is not a language tag such as en or pt-BR.`;
  }

  // Two independent windows, each ordered on its own: Google does not require the redemption window
  // to sit inside the serving one, so neither does upstream, and neither does this.
  const serving = googleAdsDateWindowRefusal('serving', promotion.startDate ?? '', promotion.endDate ?? '');
  if (serving) return serving;
  const redemption = googleAdsDateWindowRefusal('redemption', promotion.redemptionStartDate ?? '', promotion.redemptionEndDate ?? '');
  if (redemption) return redemption;

  return googleAdsAssetUrlRefusal('The promotion', promotion.finalUrl);
}

/**
 * Why upstream would refuse this price extension, or `null` when it would not.
 *
 * `validatePriceExtensions`' branches in order: type blank or not an enum name, a qualifier that is
 * not one, language blank or not a tag, the {@link GOOGLE_ADS_MIN_PRICE_OFFERINGS}..
 * {@link GOOGLE_ADS_MAX_PRICE_OFFERINGS} row count; then each row — header blank, over
 * {@link GOOGLE_ADS_MAX_PRICE_HEADER_RUNES} runes, a case-folded repeat within the table; description
 * blank, over {@link GOOGLE_ADS_MAX_PRICE_DESCRIPTION_RUNES} runes; the price; the unit's shape; the
 * destination. The first bad row wins, and its 1-based number is named.
 *
 * No `earlier` list: upstream does not de-duplicate price extensions against one another, only rows
 * within one.
 */
export function googlePriceExtensionRefusal(price: CampaignPriceExtension): string | null {
  if (price.type === '') return 'It has no type — Google needs to know what kind of table this is, such as EVENTS or SERVICES.';
  if (!GOOGLE_ADS_ENUM_NAME_PATTERN.test(price.type)) {
    return `The type ${googleAdsEchoed(price.type)} is not a type name — Google spells these in upper case with underscores, such as PRODUCT_TIERS.`;
  }
  const qualifier = price.priceQualifier ?? '';
  if (qualifier !== '' && !GOOGLE_ADS_ENUM_NAME_PATTERN.test(qualifier)) {
    return `The price qualifier ${googleAdsEchoed(qualifier)} is not a qualifier name — Google spells these in upper case, such as FROM or UP_TO.`;
  }
  if (price.languageCode === '') return 'It has no language code — Google refuses a price extension without one.';
  if (!GOOGLE_ADS_ASSET_LANGUAGE_PATTERN.test(price.languageCode)) {
    return `The language code ${googleAdsEchoed(price.languageCode)} is not a language tag such as en or pt-BR.`;
  }
  const rows = price.offerings;
  if (rows.length < GOOGLE_ADS_MIN_PRICE_OFFERINGS || rows.length > GOOGLE_ADS_MAX_PRICE_OFFERINGS) {
    return `It has ${rows.length} rows — Google requires between ${GOOGLE_ADS_MIN_PRICE_OFFERINGS} and ${GOOGLE_ADS_MAX_PRICE_OFFERINGS}.`;
  }

  const seenHeaders = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const label = `Row ${index + 1}`;
    if (row.header === '') return `${label} has no header.`;
    const headerRunes = [...row.header].length;
    if (headerRunes > GOOGLE_ADS_MAX_PRICE_HEADER_RUNES)
      return `${label}'s header is ${headerRunes} characters — the limit is ${GOOGLE_ADS_MAX_PRICE_HEADER_RUNES}.`;
    // Google serves one row per header, so a repeat is a row the operator would silently lose.
    const key = googleAdsToLower(row.header);
    if (seenHeaders.has(key)) return `${label} repeats the header ${googleAdsEchoed(row.header)} — Google serves one row per header.`;
    seenHeaders.add(key);
    if (row.description === '') return `${label} has no description.`;
    const descriptionRunes = [...row.description].length;
    if (descriptionRunes > GOOGLE_ADS_MAX_PRICE_DESCRIPTION_RUNES) {
      return `${label}'s description is ${descriptionRunes} characters — the limit is ${GOOGLE_ADS_MAX_PRICE_DESCRIPTION_RUNES}.`;
    }
    const money = googleAdsMoneyRefusal(`price on ${label.toLowerCase()}`, row.amount, row.currencyCode);
    if (money) return money;
    const unit = row.unit ?? '';
    if (unit !== '' && !GOOGLE_ADS_ENUM_NAME_PATTERN.test(unit)) {
      return `${label}'s unit ${googleAdsEchoed(unit)} is not a unit name — Google spells these in upper case, such as PER_DAY.`;
    }
    const url = googleAdsAssetUrlRefusal(label, row.finalUrl);
    if (url) return url;
  }
  return null;
}

/**
 * `validateMoney`'s checks in its order: currency blank, not ISO 4217, then the amount — finite, at
 * most {@link GOOGLE_ADS_MAX_ASSET_AMOUNT}, and still above zero once rounded to micros, so a
 * sub-micro amount is refused as upstream refuses it rather than reaching Google as unset.
 */
function googleAdsMoneyRefusal(label: string, amount: number, currencyCode: string): string | null {
  if (currencyCode === '') return `The ${label} has no currency code — Google cannot interpret a bare number.`;
  if (!GOOGLE_ADS_CURRENCY_CODE_PATTERN.test(currencyCode))
    return `The currency code ${googleAdsEchoed(currencyCode)} must be a three-letter ISO code such as USD.`;
  if (!Number.isFinite(amount)) return `The ${label} must be a number.`;
  if (amount > GOOGLE_ADS_MAX_ASSET_AMOUNT) return `The ${label} exceeds the maximum of ${GOOGLE_ADS_MAX_ASSET_AMOUNT}.`;
  if (Math.round(amount * GOOGLE_ADS_MICROS_PER_UNIT) <= 0) return `The ${label} must be greater than 0.`;
  return null;
}

/**
 * `validateAssetDateWindow`: each date, when present, is `YYYY-MM-DD` and a real calendar day, and
 * the end is not before the start. The same day for both is accepted, as upstream accepts it.
 */
function googleAdsDateWindowRefusal(window: string, startDate: string, endDate: string): string | null {
  for (const [which, date] of [
    ['start', startDate],
    ['end', endDate],
  ] as const) {
    if (date === '') continue;
    if (!GOOGLE_ADS_ASSET_DATE_PATTERN.test(date) || !isCalendarDate(date))
      return `The ${window} ${which} date ${googleAdsEchoed(date)} is not a valid YYYY-MM-DD date.`;
  }
  // Fixed-width, zero-padded dates order the same as strings and as days.
  if (startDate !== '' && endDate !== '' && endDate < startDate) return `The ${window} end date ${endDate} is before its start date ${startDate}.`;
  return null;
}

/**
 * Whether a `YYYY-MM-DD` string names a real day, as Go's `time.Parse` decides it — a month of
 * 1-12 and a day within that month, leap years included. Arithmetic rather than `Date`, which
 * silently rolls `02-30` into March and reads two-digit years as the 1900s.
 */
function isCalendarDate(date: string): boolean {
  const [year, month, day] = date.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}

/**
 * `buildTaggedFinalURL`'s servable-URL refusal, then the byte bound measured untagged. `subject`
 * names whose destination it is — the promotion, or one row of a price table.
 */
function googleAdsAssetUrlRefusal(subject: string, finalUrl: string): string | null {
  if (finalUrl === '') return `${subject} has no destination URL.`;
  if (!isGoogleAdsServableUrl(finalUrl)) {
    return `${subject}'s destination must be a full http:// or https:// URL with a hostname, no embedded credentials, no semicolons in the query and no stray % signs.`;
  }
  const bytes = new TextEncoder().encode(finalUrl).length;
  if (bytes > GOOGLE_ADS_MAX_FINAL_URL_BYTES) return `${subject}'s destination URL is ${bytes} bytes — Google's limit is ${GOOGLE_ADS_MAX_FINAL_URL_BYTES}.`;
  return null;
}
