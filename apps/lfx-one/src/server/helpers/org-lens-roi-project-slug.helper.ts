// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_ID_PATTERN } from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';

/**
 * Validates the ROI project slug path parameter.
 *
 * The same pattern the Org Lens project detail routes validate against, and the same pattern for a
 * reason: ROI project identity comes from `silver_dim_projects`, the dimension behind
 * `ORG_LENS_PROJECTS.PROJECT_SLUG`, so the two surfaces address the same slug space and disagreeing
 * about which slugs are addressable would make the onward link between them unreliable.
 *
 * This also has to run before the slug reaches a cache key. The sub-resource a caller supplies to
 * `buildOrgCacheKey` is not validated there, and the key is `:`-delimited, so an unconstrained slug
 * could reshape it.
 */
export function assertOrgLensRoiProjectSlug(projectSlug: string | undefined, operation: string): asserts projectSlug is string {
  if (!projectSlug || typeof projectSlug !== 'string') {
    throw ServiceValidationError.forField('projectSlug', 'projectSlug path parameter is required', { operation });
  }
  if (!FOUNDATION_ID_PATTERN.test(projectSlug)) {
    throw ServiceValidationError.forField('projectSlug', 'Invalid projectSlug format', { operation });
  }
}
