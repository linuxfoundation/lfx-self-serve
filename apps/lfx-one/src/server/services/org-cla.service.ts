// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import type { OrgClaGroupList } from '../types/org-cla.types';

export class OrgClaService {
  public async listClaGroups(_req: Request, orgUid: string): Promise<OrgClaGroupList> {
    return { orgUid, claGroups: [] };
  }
}
