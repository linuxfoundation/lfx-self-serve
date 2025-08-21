// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Project slug to ID response payload
 */
export interface ProjectSlugToIdResponse {
  projectId: string;
  slug: string;
  exists: boolean;
}

/**
 * NATS message subjects enum
 */
export enum NatsSubjects {
  PROJECT_SLUG_TO_UID = 'lfx.projects-api.slug_to_uid',
}
