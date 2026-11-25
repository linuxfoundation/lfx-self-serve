// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  googleAdsUrlParseFlaw,
  LINKEDIN_CAROUSEL_CARD_REQUEST_KEYS,
  LINKEDIN_CAROUSEL_CARDS_FIELD,
  LINKEDIN_CAROUSEL_INTRO_TEXT_FIELD,
  LINKEDIN_CAROUSEL_LIMITS,
  LINKEDIN_LEAD_GEN_OBJECTIVE,
  LINKEDIN_OBJECTIVE_FIELD,
} from '../constants/campaign.constants';
import { UUID_REGEX } from '../constants/regex.constants';
import type { LinkedInConfigKeyRefusal } from '../interfaces/campaign.interface';
import { goTrimSpace, linkedInCreativeTextLength } from './campaign-linkedin.utils';

/**
 * LinkedIn carousel ads (linuxfoundation/lfx-v2-campaign-service#665), mirroring campaign-service's checks
 * (`linkedinFormat`, `checkCarouselFieldShape` and `linkedinCarouselFormat` in `internal/dispatch/linkedin_text_ads.go` and
 * `linkedin_carousel.go`, `ValidateCarousel` and `validateLandingURL` in `internal/platform/linkedin`), so a create
 * campaign-service would refuse is refused here first, with a field to point at. Two checks are campaign-service's alone:
 * whether each card's image is a square PNG or JPEG of the brief (only it reads the stored asset), and whether a card's
 * link is still within 2,000 characters once its UTM parameters are added (only it builds the campaign name they carry).
 * An image id must be the canonical hyphenated UUID the asset store issues, which is stricter than Go's `uuid.Parse`.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The UTF-8 length Go's `len` gives a string. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Why a card's non-blank `destinationUrl` fails campaign-service's `validateLandingURL`, as a clause, or `null`: not an
 * absolute http(s) URL with a host Go parses, a user name or password in it, a malformed query (`url.ParseQuery` refuses a
 * bad `%` escape and a `;`), or over LinkedIn's 2,000-byte limit.
 */
export function linkedInCarouselDestinationProblem(raw: string): string | null {
  const url = goTrimSpace(raw);
  const prefix = /^https?:\/\//i.exec(url);
  if (!prefix || googleAdsUrlParseFlaw(url)) return 'must be a full http:// or https:// link';
  const rest = url.slice(prefix[0].length);
  const authority = rest.slice(0, rest.search(/[/?#]|$/));
  // Go's `Hostname()` is empty for "https://:443/", which `validateLandingURL` refuses.
  if (authority.includes('@')) return 'must not carry a user name or password';
  if (authority.replace(/:[0-9]*$/, '') === '') return 'must be a full http:// or https:// link';
  const beforeFragment = url.split('#')[0];
  const queryAt = beforeFragment.indexOf('?');
  const query = queryAt === -1 ? '' : beforeFragment.slice(queryAt + 1);
  if (/%(?![0-9A-Fa-f]{2})/.test(query) || query.includes(';')) return 'has a malformed query string';
  if (byteLength(url) > LINKEDIN_CAROUSEL_LIMITS.destinationBytes) return `can be at most ${LINKEDIN_CAROUSEL_LIMITS.destinationBytes} characters`;
  return null;
}

/** Why card `index` cannot be sent, or `null`. A key outside the three is `linkedInConfigKeyRefusal`'s. */
function carouselCardRefusal(card: Record<string, unknown>, index: number): LinkedInConfigKeyRefusal | null {
  const path = `${LINKEDIN_CAROUSEL_CARDS_FIELD}[${index}]`;
  const n = index + 1;
  const image = goTrimSpace(typeof card['imageAssetId'] === 'string' ? card['imageAssetId'] : '');
  if (image === '') return { field: `${path}.imageAssetId`, message: `Card ${n} needs an image.` };
  if (!UUID_REGEX.test(image)) return { field: `${path}.imageAssetId`, message: `Card ${n}'s image must be an image stored for this brief.` };
  const headline = linkedInCreativeTextLength(typeof card['headline'] === 'string' ? card['headline'] : '');
  if (headline === 0) return { field: `${path}.headline`, message: `Enter card ${n}'s headline.` };
  if (headline > LINKEDIN_CAROUSEL_LIMITS.headline) {
    return { field: `${path}.headline`, message: `Card ${n}'s headline can be at most ${LINKEDIN_CAROUSEL_LIMITS.headline} characters.` };
  }
  const destination = typeof card['destinationUrl'] === 'string' ? card['destinationUrl'] : '';
  const problem = goTrimSpace(destination) === '' ? null : linkedInCarouselDestinationProblem(destination);
  if (problem !== null) return { field: `${path}.destinationUrl`, message: `Card ${n}'s link ${problem}.` };
  return null;
}

/**
 * Why `raw`'s carousel fields cannot be sent, or `null` (campaign-service#665). Typed runtime checks, since the create
 * route has no body validator. A create names a carousel with `format: "carousel"`, a `carouselCards` key, or a
 * `carouselIntroText` other than `""` (campaign-service reads `""` as omitted). With none, nothing is checked. Refused:
 *
 * - any of them while this deployment cannot send them (`enabled`): refused, never dropped, since the legacy creator
 *   would make a single-image campaign instead and campaign-service refuses them while `LINKEDIN_ADS_CAROUSEL_ENABLED` is off;
 * - a `carouselIntroText` that is not text, or a `carouselCards` that is not a list of objects whose fields are text
 *   (`null` included, as campaign-service's `checkCarouselFieldShape` refuses it);
 * - cards or intro text without `format: "carousel"`;
 * - a carousel with `textAds`, with `variants` (the carousel is the one creative, so no single image or video ads), or
 *   with the `lead_generation` objective (campaign-service builds no lead gen carousel);
 * - fewer than 2 or more than 10 cards, an intro text blank or over 255 characters once normalized;
 * - a card without an image id that is a creative asset id (a UUID), with a headline blank or over 45 characters once
 *   normalized (refused, never cut), or with a destination `linkedInCarouselDestinationProblem` names.
 *
 * Messages never echo a caller value.
 */
export function linkedInCarouselRefusal(raw: unknown, enabled: boolean): LinkedInConfigKeyRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  const carousel = config['format'] === 'carousel';
  const hasCards = 'carouselCards' in config;
  const hasIntro = 'carouselIntroText' in config && config['carouselIntroText'] !== '';
  if (!carousel && !hasCards && !hasIntro) return null;
  if (!enabled) {
    let field = 'linkedInConfig.format';
    if (!carousel) field = hasCards ? LINKEDIN_CAROUSEL_CARDS_FIELD : LINKEDIN_CAROUSEL_INTRO_TEXT_FIELD;
    return { field, message: 'This deployment cannot create LinkedIn carousel ads. Choose single image ads to create the campaign.' };
  }
  if (hasIntro && typeof config['carouselIntroText'] !== 'string')
    return { field: LINKEDIN_CAROUSEL_INTRO_TEXT_FIELD, message: 'Send the intro text as text.' };
  const cards = config['carouselCards'];
  // Every field of every card must be text: campaign-service refuses a null or a number in any of them.
  const malformed =
    hasCards &&
    (!Array.isArray(cards) ||
      cards.some((card) => {
        const record = plainRecord(card);
        return record === null || LINKEDIN_CAROUSEL_CARD_REQUEST_KEYS.some((key) => key in record && typeof record[key] !== 'string');
      }));
  if (malformed) {
    return { field: LINKEDIN_CAROUSEL_CARDS_FIELD, message: 'Send the cards as a list, each with a text image id, headline and optional link.' };
  }
  if (!carousel) {
    return {
      field: hasCards ? LINKEDIN_CAROUSEL_CARDS_FIELD : LINKEDIN_CAROUSEL_INTRO_TEXT_FIELD,
      message: 'Carousel cards go only with the carousel format.',
    };
  }
  // Any `textAds` key, `null` included: campaign-service's `checkFormatShape` refuses a null list too.
  if ('textAds' in config) return { field: 'linkedInConfig.textAds', message: 'Text ads go only with the text ad format.' };
  const variants = config['variants'];
  if (Array.isArray(variants) && variants.length > 0) {
    return { field: 'linkedInConfig.variants', message: 'A carousel campaign takes its ad from the cards. Send no single image or video ads.' };
  }
  if (config['objective'] === LINKEDIN_LEAD_GEN_OBJECTIVE) {
    return { field: LINKEDIN_OBJECTIVE_FIELD, message: 'Lead gen form campaigns cannot be carousels yet. Choose another objective or format.' };
  }
  const list = Array.isArray(cards) ? (cards as Record<string, unknown>[]) : [];
  const { minCards, maxCards, introText } = LINKEDIN_CAROUSEL_LIMITS;
  if (list.length < minCards || list.length > maxCards) {
    return { field: LINKEDIN_CAROUSEL_CARDS_FIELD, message: `A LinkedIn carousel takes ${minCards} to ${maxCards} cards.` };
  }
  const intro = linkedInCreativeTextLength(typeof config['carouselIntroText'] === 'string' ? config['carouselIntroText'] : '');
  if (intro === 0) return { field: LINKEDIN_CAROUSEL_INTRO_TEXT_FIELD, message: 'Enter the carousel intro text.' };
  if (intro > introText) return { field: LINKEDIN_CAROUSEL_INTRO_TEXT_FIELD, message: `The carousel intro text can be at most ${introText} characters.` };
  for (const [index, card] of list.entries()) {
    const refusal = carouselCardRefusal(card, index);
    if (refusal !== null) return refusal;
  }
  return null;
}
