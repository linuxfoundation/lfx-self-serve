// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_CAROUSEL_CARDS_FIELD,
  LINKEDIN_CAROUSEL_INTRO_TEXT_FIELD,
  LINKEDIN_DOCUMENT_ASSET_FIELD,
  LINKEDIN_DOCUMENT_INTRO_TEXT_FIELD,
  LINKEDIN_DOCUMENT_LIMITS,
  LINKEDIN_DOCUMENT_REQUEST_FIELDS,
  LINKEDIN_DOCUMENT_TITLE_FIELD,
  LINKEDIN_LEAD_GEN_OBJECTIVE,
  LINKEDIN_OBJECTIVE_FIELD,
} from '../constants/campaign.constants';
import { UUID_REGEX } from '../constants/regex.constants';
import type { LinkedInConfigKeyRefusal } from '../interfaces/campaign.interface';
import { goTrimSpace, linkedInCreativeTextLength } from './campaign-linkedin.utils';

/**
 * LinkedIn document ads (linuxfoundation/lfx-v2-campaign-service#665), mirroring campaign-service's checks
 * (`checkDocumentFieldShape`, `linkedinFormat` and `linkedinDocumentFormat` in `internal/dispatch/linkedin_document.go`
 * and `linkedin_text_ads.go`, `ValidateDocumentFields` in `internal/platform/linkedin/documents.go`), so a create
 * campaign-service would refuse is refused here first, with a field to point at. Whether the asset is a PDF stored for
 * this brief is campaign-service's alone to judge (only it reads the stored asset). An asset id must be the canonical
 * hyphenated UUID the asset store issues, which is stricter than Go's `uuid.Parse`, as for a carousel card's image.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Why the title or intro text (`text`) cannot be sent, or `null`: blank or dash-only once normalized, or over `max`. */
function documentTextRefusal(field: string, label: string, text: string, max: number): LinkedInConfigKeyRefusal | null {
  const length = linkedInCreativeTextLength(text);
  if (length === 0) return { field, message: `Enter the document ${label}.` };
  if (length > max) return { field, message: `The document ${label} can be at most ${max} characters.` };
  return null;
}

/**
 * Why `raw`'s document fields cannot be sent, or `null` (campaign-service#665). Typed runtime checks, since the create
 * route has no body validator. A create names a document with `format: "document"`, or with a `documentAssetId`,
 * `documentTitle` or `documentIntroText` other than `""` (campaign-service reads `""` as omitted). With none, nothing is
 * checked. Refused, in campaign-service's order:
 *
 * - any of them while this deployment cannot send them (`enabled`): refused, never dropped, since the legacy creator
 *   would make a single-image campaign instead and campaign-service refuses them while `LINKEDIN_ADS_DOCUMENT_ENABLED` is
 *   off;
 * - a document field that is not text (`null` included, as `checkDocumentFieldShape` refuses it);
 * - document fields without `format: "document"`;
 * - a document with `variants`, `textAds` or carousel fields: the document is the one creative;
 * - a document with an objective other than lead generation (a document is an engagement ad by default; LinkedIn offers
 *   document ads no website visits or conversions), or with a manual bid (both objectives are automatic only);
 * - no asset id, or one that is not a creative asset id (a UUID);
 * - a title blank or over 70 characters, or intro text blank or over 600, once normalized.
 *
 * Messages never echo a caller value.
 */
export function linkedInDocumentRefusal(raw: unknown, enabled: boolean): LinkedInConfigKeyRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  const document = config['format'] === 'document';
  const present = LINKEDIN_DOCUMENT_REQUEST_FIELDS.find(([key]) => key in config && config[key] !== '');
  if (!document && !present) return null;
  if (!enabled) {
    return {
      field: document || !present ? 'linkedInConfig.format' : present[1],
      message: 'This deployment cannot create LinkedIn document ads. Choose single image ads to create the campaign.',
    };
  }
  const malformed = LINKEDIN_DOCUMENT_REQUEST_FIELDS.find(([key]) => key in config && typeof config[key] !== 'string');
  if (malformed) return { field: malformed[1], message: 'Send it as text.' };
  if (!document) return { field: present ? present[1] : 'linkedInConfig.format', message: 'The document fields go only with the document format.' };
  const variants = config['variants'];
  if (Array.isArray(variants) && variants.length > 0) {
    return { field: 'linkedInConfig.variants', message: 'A document campaign takes its ad from the PDF. Send no single image or video ads.' };
  }
  // Any `textAds` key, `null` included: campaign-service's `checkFormatShape` refuses a null list too.
  if ('textAds' in config) return { field: 'linkedInConfig.textAds', message: 'Text ads go only with the text ad format.' };
  if ('carouselCards' in config) return { field: LINKEDIN_CAROUSEL_CARDS_FIELD, message: 'Carousel cards go only with the carousel format.' };
  // campaign-service reads an empty intro text as omitted.
  if ('carouselIntroText' in config && config['carouselIntroText'] !== '') {
    return { field: LINKEDIN_CAROUSEL_INTRO_TEXT_FIELD, message: 'Carousel cards go only with the carousel format.' };
  }
  const objective = config['objective'];
  // Omitted (or `""`, which campaign-service reads as omitted) is the engagement default.
  if (objective !== undefined && objective !== '' && objective !== LINKEDIN_LEAD_GEN_OBJECTIVE) {
    return {
      field: LINKEDIN_OBJECTIVE_FIELD,
      message:
        'A document ad is an engagement ad, or a lead generation ad with a form. LinkedIn offers document ads no website visits or conversions objective.',
    };
  }
  if (plainRecord(config['bidding'])?.['strategy'] === 'manual') {
    return { field: 'linkedInConfig.bidding', message: 'A document ad takes automatic bidding only. Remove the manual bid.' };
  }
  const assetId = goTrimSpace(typeof config['documentAssetId'] === 'string' ? config['documentAssetId'] : '');
  if (assetId === '') return { field: LINKEDIN_DOCUMENT_ASSET_FIELD, message: 'Choose the PDF the document ad shows.' };
  if (!UUID_REGEX.test(assetId)) return { field: LINKEDIN_DOCUMENT_ASSET_FIELD, message: 'The document must be a PDF stored for this brief.' };
  const text = (key: string) => (typeof config[key] === 'string' ? (config[key] as string) : '');
  return (
    documentTextRefusal(LINKEDIN_DOCUMENT_TITLE_FIELD, 'title', text('documentTitle'), LINKEDIN_DOCUMENT_LIMITS.title) ??
    documentTextRefusal(LINKEDIN_DOCUMENT_INTRO_TEXT_FIELD, 'intro text', text('documentIntroText'), LINKEDIN_DOCUMENT_LIMITS.introText)
  );
}

/**
 * Whether a create's LinkedIn ad is a document (campaign-service#665): its post carries the PDF and no landing page, so
 * campaign-service needs no registration URL for it.
 */
export function linkedInConfigIsDocument(raw: unknown): boolean {
  return plainRecord(raw)?.['format'] === 'document';
}
