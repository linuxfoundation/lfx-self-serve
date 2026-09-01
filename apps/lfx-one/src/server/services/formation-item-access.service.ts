// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationItem } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { personaDetectionService } from '../utils/persona-helper';

/**
 * Resolves the per-item `gate_writer` permission (GH-1958) attached to every `FormationItem` DTO
 * as `can_complete`, mirroring how `committee.writer` is attached via
 * `AccessCheckService.addAccessToResource(s)` in `committee.service.ts`.
 *
 * TODO(#1957): `gate_writer` is not yet a real FGA relation (`lfx-v2-formation-service`/
 * `lfx-v2-helm` haven't shipped the `formation_item` type). `canComplete` fabricates the answer
 * from a real LF-staff check in the meantime — once the relation ships, replace this method's body
 * with `accessCheckService.checkSingleAccess(req, { resource: 'formation_item', id: item.uid,
 * access: 'gate_writer' })`; the call shape already type-checks against `AccessCheckAccessType`, so
 * no caller of `canComplete` needs to change.
 */
export class FormationItemAccessService {
  /** Non-gating items: anyone with checklist access may complete them. Gating items: LF-staff only, standing in for a real `gate_writer` grant. */
  public async canComplete(req: Request, item: Pick<FormationItem, 'is_gating'>): Promise<boolean> {
    if (!item.is_gating) {
      return true;
    }

    return personaDetectionService.checkLFStaff(req);
  }
}

export const formationItemAccessService = new FormationItemAccessService();
