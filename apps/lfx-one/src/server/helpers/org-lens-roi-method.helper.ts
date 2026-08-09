// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_ROI_DEFAULT_METHOD, ORG_LENS_ROI_METHODS } from '@lfx-one/shared/constants';
import type { OrgLensRoiMethod } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';

const SUPPORTED = new Set<string>(ORG_LENS_ROI_METHODS);

// Only an absent `method` defaults; any other unrecognized value is rejected, never defaulted.
export function parseOrgLensRoiMethod(rawMethod: unknown, operation: string): OrgLensRoiMethod {
  if (rawMethod === undefined) {
    return ORG_LENS_ROI_DEFAULT_METHOD;
  }
  if (typeof rawMethod !== 'string' || !SUPPORTED.has(rawMethod)) {
    throw ServiceValidationError.forField('method', `method must be one of: ${ORG_LENS_ROI_METHODS.join(', ')}`, { operation });
  }
  return rawMethod as OrgLensRoiMethod;
}
