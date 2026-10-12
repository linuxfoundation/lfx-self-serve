// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal } from '@angular/core';
import { ORG_LENS_CLA_M3_ENABLED_FLAG } from '@lfx-one/shared/constants';

import { FeatureFlagService } from './feature-flag.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

const NO_ORGS: ReadonlySet<string> = new Set();

/**
 * M3 — organizations the caller reaches only as their CLA Manager, behind `org-lens-cla-m3-enabled`.
 * Every Angular surface that widens for a CLA-only org (selector visibility, selector rows, sidebar,
 * page redirect) reads it here, so the flag gates them together. The server gates the data itself.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgClaOnlyAccessService {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly orgRoleGrants = inject(OrgRoleGrantsService);

  public readonly enabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(ORG_LENS_CLA_M3_ENABLED_FLAG, false);

  /** Empty while the flag is off, whatever the server sent. */
  public readonly claOnlyOrgUids: Signal<ReadonlySet<string>> = computed(() => (this.enabled() ? this.orgRoleGrants.claManagerOrgSet() : NO_ORGS));

  public isClaOnly(uid: string | null | undefined): boolean {
    return !!uid && this.claOnlyOrgUids().has(uid);
  }
}
