// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  NEWSLETTER_BODY_LAYOUT_MAX_BYTES,
  NEWSLETTER_BODY_MAX_LENGTH,
  NEWSLETTER_MAX_COMMITTEES,
  NEWSLETTER_SUBJECT_MAX_LENGTH,
} from '@lfx-one/shared/constants';
import { NewsletterCreateFields } from '@lfx-one/shared/interfaces';
import { newsletterLayoutDepthError } from '@lfx-one/shared/utils';

import { ServiceValidationError } from '../errors';

/**
 * Checks a newsletter created as an edition of a publication (#4349), on both POST .../newsletters
 * with a `publication_uid` and POST .../newsletter-publications/:publicationUid/editions.
 *
 * The service applies the publication's defaults before it validates, so a field the publication can
 * supply may be left out. An omitted `committee_uids` takes the publication's audience, and a blank
 * `ed_reply_email` takes its reply-to. Only the fields that are sent are checked here, with the same
 * shape and size rules as a create without a publication. The subject is never inherited, so it is
 * always required. The service owns the rest, such as a body for a publication with no template set.
 */
export function validateNewsletterEditionPayload(
  payload: Partial<NewsletterCreateFields>,
  context: { operation: string; service: string; path: string }
): void {
  const fieldErrors: Record<string, string> = {};

  if (typeof payload.subject !== 'string' || payload.subject.trim().length === 0) {
    fieldErrors['subject'] = 'Subject is required';
  } else if (payload.subject.length > NEWSLETTER_SUBJECT_MAX_LENGTH) {
    fieldErrors['subject'] = `Subject must be ${NEWSLETTER_SUBJECT_MAX_LENGTH} characters or fewer`;
  }

  // An explicit empty list is refused, as the service does, so clearing a selection can't fall back
  // to the publication's audience. A JSON null decodes upstream the same as an omitted list.
  const committees: unknown = payload.committee_uids;
  if (
    committees !== undefined &&
    committees !== null &&
    (!Array.isArray(committees) ||
      committees.length === 0 ||
      committees.length > NEWSLETTER_MAX_COMMITTEES ||
      !committees.every((uid) => typeof uid === 'string' && uid.trim().length > 0))
  ) {
    fieldErrors['committee_uids'] = `committee_uids must be an array of 1 to ${NEWSLETTER_MAX_COMMITTEES} non-empty strings`;
  }

  const layoutPresent = payload.body_layout !== undefined && payload.body_layout !== null;
  const layoutHasBlocks = layoutPresent && typeof payload.body_layout === 'object' && Array.isArray(payload.body_layout!.blocks);
  // Depth before the byte cap: JSON.stringify recurses and would throw on a very deep layout first.
  const depthError = layoutHasBlocks ? newsletterLayoutDepthError(payload.body_layout!.blocks) : null;
  if (layoutPresent && !layoutHasBlocks) {
    fieldErrors['body_layout'] = 'A block layout must have a blocks array';
  } else if (depthError) {
    fieldErrors['body_layout'] = depthError;
  } else if (layoutPresent && Buffer.byteLength(JSON.stringify(payload.body_layout), 'utf8') > NEWSLETTER_BODY_LAYOUT_MAX_BYTES) {
    fieldErrors['body_layout'] = `Layout must be ${NEWSLETTER_BODY_LAYOUT_MAX_BYTES} bytes or fewer when serialized`;
  }
  // body_html is capped only on the html path. With a layout the service re-renders it.
  if (payload.body_html !== undefined && typeof payload.body_html !== 'string') {
    fieldErrors['body_html'] = 'body_html must be a string';
  } else if (!layoutPresent && typeof payload.body_html === 'string' && payload.body_html.length > NEWSLETTER_BODY_MAX_LENGTH) {
    fieldErrors['body_html'] = `Body must be ${NEWSLETTER_BODY_MAX_LENGTH} characters or fewer`;
  }

  const replyEmail: unknown = payload.ed_reply_email;
  if (replyEmail !== undefined && (typeof replyEmail !== 'string' || (replyEmail.trim().length > 0 && !replyEmail.includes('@')))) {
    fieldErrors['ed_reply_email'] = 'ed_reply_email must be a valid email address';
  }

  if (payload.scheduled_at !== undefined && payload.scheduled_at !== null) {
    const at = typeof payload.scheduled_at === 'string' ? new Date(payload.scheduled_at).getTime() : NaN;
    if (!Number.isFinite(at) || at <= Date.now()) {
      fieldErrors['scheduled_at'] = 'scheduled_at must be a future timestamp';
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', context);
  }
}
