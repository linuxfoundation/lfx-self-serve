// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';

import { OrgRoleGrantsService } from './org-role-grants.service';

const NO_ORGS: ReadonlySet<string> = new Set();

/**
 * M3 — organizations the caller reaches only as their CLA Manager. Every Angular surface that widens
 * for a CLA-only org (selector visibility, selector rows, sidebar, page redirect) reads it here. The
 * server gates the data itself.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgClaOnlyAccessService {
  private readonly orgRoleGrants = inject(OrgRoleGrantsService);

  private readonly addressedClaOnlyUids: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(NO_ORGS);

  /** Selector entries. */
  public readonly claOnlyOrgUids: Signal<ReadonlySet<string>> = this.orgRoleGrants.claManagerOrgSet;

  /** The caller's CLA-manager companies could not be read, so `claOnlyOrgUids` being empty is unknown. */
  public readonly lookupFailed: Signal<boolean> = this.orgRoleGrants.claManagerLookupFailed;

  public isClaOnly(uid: string | null | undefined): boolean {
    if (!uid) return false;
    // A grant that arrived after the address was resolved wins: the selected organization skips the
    // resolver on later navigations, so nothing else would clear the note.
    if (this.holdsOrgLensAccess(uid)) return false;
    return this.claOnlyOrgUids().has(uid) || this.addressedClaOnlyUids().has(uid);
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
