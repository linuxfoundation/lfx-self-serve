// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BaseApiError } from './base.error';

/**
 * A repo-owned content file exists but failed validation, so it cannot be served (500).
 * The client message stays generic; the validation problems are logged at startup, not returned.
 */
export class ContentUnavailableError extends BaseApiError {
  public constructor(
    resourceType: string,
    resourceId: string,
    options: {
      operation?: string;
      service?: string;
      path?: string;
    } = {}
  ) {
    super(`${resourceType} '${resourceId}' failed content validation`, 500, 'CONTENT_UNAVAILABLE', {
      ...options,
      clientMessage: `This ${resourceType.toLowerCase()} isn't available right now.`,
    });
  }
}
