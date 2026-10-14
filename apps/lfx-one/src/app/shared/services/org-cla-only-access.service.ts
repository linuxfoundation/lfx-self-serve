// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
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

  /**
   * Organizations an address resolved as CLA-only (`OrgResolveResponse.claOnly`). Kept apart from
   * `claOnlyOrgUids`: a caller with an Org Lens grant elsewhere reaches these by direct link only, so
   * they shape that organization's pages but never add it to the selector.
   */
  private readonly addressedClaOnlyUids: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(NO_ORGS);

  /** Selector entries. Empty while the flag is off, whatever the server sent. */
  public readonly claOnlyOrgUids: Signal<ReadonlySet<string>> = computed(() => (this.enabled() ? this.orgRoleGrants.claManagerOrgSet() : NO_ORGS));

  /** The caller's CLA-manager companies could not be read, so `claOnlyOrgUids` being empty is unknown. False while the flag is off. */
  public readonly lookupFailed: Signal<boolean> = computed(() => this.enabled() && this.orgRoleGrants.claManagerLookupFailed());

  public isClaOnly(uid: string | null | undefined): boolean {
    if (!uid) return false;
    if (this.claOnlyOrgUids().has(uid)) return true;
    // A grant that arrived after the address was resolved wins: the selected organization skips the
    // resolver on later navigations, so nothing else would clear the note.
    return this.enabled() && this.addressedClaOnlyUids().has(uid) && !this.holdsOrgLensAccess(uid);
  }

  /** Records the resolver's answer for an addressed organization; a later non-CLA-only answer clears it. */
  public noteAddressed(uid: string, claOnly: boolean): void {
    const current = this.addressedClaOnlyUids();
    if (current.has(uid) === claOnly) return;
    const next = new Set(current);
    if (claOnly) {
      next.add(uid);
    } else {
      next.delete(uid);
    }
    this.addressedClaOnlyUids.set(next);
  }

  /** The caller's current role grants open the whole lens for `uid` (direct, inherited, or company-wide team). */
  private holdsOrgLensAccess(uid: string): boolean {
    return (
      this.orgRoleGrants.isStaff() ||
      this.orgRoleGrants.writerSet().has(uid) ||
      this.orgRoleGrants.auditorSet().has(uid) ||
      this.orgRoleGrants.inheritedWriterSet().has(uid) ||
      this.orgRoleGrants.inheritedAuditorSet().has(uid)
    );
  }
}
