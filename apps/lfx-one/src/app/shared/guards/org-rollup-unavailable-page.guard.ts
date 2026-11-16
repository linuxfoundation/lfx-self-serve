// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { ORG_LENS_PAGE_SEGMENTS } from '@lfx-one/shared/constants';
import { isOrgRollUpSegment, normalizeOrgSegment } from '@lfx-one/shared/utils';

import { AccountContextService } from '../services/account-context.service';

/**
 * Matches an Org Lens page that cannot render a family roll-up yet, so the roll-up-unavailable page
 * declared ahead of it in `app.routes.ts` renders instead and the page itself never loads, rather than
 * reading the roll-up key as one organization (#4133). The address is kept, so the sidebar still marks
 * the page and a bookmark still names it.
 *
 * A CanMatch, not a CanActivate: it has to run before the page is chosen. That is also before
 * `orgPathParamGuard` has adopted `/org/family-{id}/…`, so the URL being recognized is the authority, as
 * in `orgLensFlagGuard`. The path guard still runs on the parent afterwards, and still moves a caller
 * who may not hold that roll-up to an organization in its family. Only the legacy `/org/{page}` and bare
 * `/org` name no organization; there the restored selection decides. Bare `/org` counts because a
 * redirect leaves the URL being recognized untouched, so a page reached from it still reads `/org`.
 */
export const orgRollUpUnavailablePageGuard: CanMatchFn = () => {
  const segments =
    inject(Router)
      .getCurrentNavigation()
      ?.extractedUrl.root.children['primary']?.segments.map((segment) => segment.path) ?? [];
  if (segments[0] !== 'org') {
    return false;
  }
  if (segments[1] !== undefined && isOrgRollUpSegment(normalizeOrgSegment(segments[1]))) {
    return true;
  }
  return (segments.length === 1 || ORG_LENS_PAGE_SEGMENTS[segments[1]] === true) && inject(AccountContextService).isRollUp();
};
