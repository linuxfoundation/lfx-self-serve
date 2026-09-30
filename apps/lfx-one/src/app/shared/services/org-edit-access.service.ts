// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { OrgLensEditProbe } from '@lfx-one/shared/interfaces';
import { distinctUntilChanged, map, of, switchMap } from 'rxjs';

import { AccountContextService } from './account-context.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

/**
 * #3136 — the single "may the caller edit the selected organization?" answer for every Org Lens edit
 * affordance (Profile, Projects/workspaces, Key Contacts, Board, Committee, membership detail).
 *
 * The caller's own roster answers first (`editorSet`: direct or roll-up admin, LFXV2-3029) with no
 * request. Otherwise the server's edit gate is asked (`OrgRoleGrantsService.editCheck`), which also
 * admits company-wide writers (`global_org_admin`) that no roster lists. Read-only company-wide teams
 * (`lf-staff`) are answered `false` there. UX only: every write is authorized again server-side.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgEditAccessService {
  private readonly accountContext = inject(AccountContextService);
  private readonly roleGrants = inject(OrgRoleGrantsService);

  /**
   * The organization to ask the server about: only once the roster has loaded (so a roster editor never
   * costs a request, and nothing is asked during SSR — role grants load after hydration) and only when
   * the roster does not already make the caller an editor.
   */
  private readonly probeUid: Signal<string | null> = computed(() => {
    const uid = this.accountContext.selectedAccount()?.uid;
    if (!uid || !this.roleGrants.loaded()) {
      return null;
    }
    return this.roleGrants.editorSet().has(uid) ? null : uid;
  });

  /** The server's answer for `probeUid`, keyed by uid so an answer never applies to a newer selection. */
  private readonly probe: Signal<OrgLensEditProbe | null> = toSignal(
    toObservable(this.probeUid).pipe(
      distinctUntilChanged(),
      switchMap((uid) => (uid ? this.roleGrants.editCheck(uid).pipe(map((canEdit) => ({ uid, canEdit }))) : of(null)))
    ),
    { initialValue: null }
  );

  /** True when the caller may edit the currently selected organization. */
  public readonly canEditSelected: Signal<boolean> = computed(() => {
    const uid = this.accountContext.selectedAccount()?.uid;
    if (!uid) {
      return false;
    }
    if (this.roleGrants.editorSet().has(uid)) {
      return true;
    }
    const probe = this.probe();
    return probe?.uid === uid && probe.canEdit;
  });
}
