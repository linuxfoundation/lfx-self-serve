// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  FoundationParticipatingOrgsRange,
  FoundationParticipatingOrgsSourceFoundation,
  FoundationParticipatingOrgsSourceLineFilter,
  FoundationParticipatingOrgsSourceProjectLine,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

/**
 * Seam between the BFF and the warehouse, backed by the lf-dbt `project_lens` participating-orgs table. Every read takes the
 * range, and the change against the previous period comes from the same rows as the figure.
 */
export interface FoundationParticipatingOrgsDataSource {
  /** Foundation-level totals per company, and the foundation's projects. Null when the warehouse has nothing for the slug. */
  getFoundation(req: Request, slug: string, range: FoundationParticipatingOrgsRange): Promise<FoundationParticipatingOrgsSourceFoundation | null>;
  /** Project lines for the filter; the foundation's own project is never one of them. */
  getProjectLines(
    req: Request,
    slug: string,
    range: FoundationParticipatingOrgsRange,
    filter: FoundationParticipatingOrgsSourceLineFilter
  ): Promise<FoundationParticipatingOrgsSourceProjectLine[]>;
}
