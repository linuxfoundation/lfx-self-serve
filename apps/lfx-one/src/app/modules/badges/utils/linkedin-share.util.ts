// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_ISSUER_ORG_IDS } from '@lfx-one/shared/constants';
import { EnrichedBadge } from '@lfx-one/shared/interfaces';

const LINKEDIN_ADD_TO_PROFILE_BASE = 'https://www.linkedin.com/profile/add';

/** Builds the LinkedIn "Add to profile" deep link prefilled with the badge's certification metadata (LFXV2-1925). */
export function buildLinkedInAddToProfileUrl(badge: EnrichedBadge): string {
  const params = new URLSearchParams();
  params.set('startTask', 'CERTIFICATION_NAME');
  params.set('name', badge.title);

  const issueDate = new Date(badge.issuedDate);
  if (!Number.isNaN(issueDate.getTime())) {
    params.set('issueYear', String(issueDate.getUTCFullYear()));
    // Date.getUTCMonth() is 0-indexed; LinkedIn's form expects 1-indexed months.
    params.set('issueMonth', String(issueDate.getUTCMonth() + 1));
  }

  if (badge.expiresDate) {
    const expiresDate = new Date(badge.expiresDate);
    if (!Number.isNaN(expiresDate.getTime())) {
      params.set('expirationYear', String(expiresDate.getUTCFullYear()));
      params.set('expirationMonth', String(expiresDate.getUTCMonth() + 1));
    }
  }

  const orgId = LINKEDIN_ISSUER_ORG_IDS[badge.issuer];
  if (typeof orgId === 'number') {
    params.set('organizationId', String(orgId));
  } else {
    params.set('organizationName', badge.issuer);
  }

  params.set('certId', badge.credentialId);

  const certUrl = badge.shareUrl ?? badge.credlyUrl;
  if (certUrl) {
    params.set('certUrl', certUrl);
  }

  return `${LINKEDIN_ADD_TO_PROFILE_BASE}?${params.toString()}`;
}
