// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, distinctUntilChanged, EMPTY, map, scan, switchMap } from 'rxjs';

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

  /**
   * The server's answers, one per organization asked about, so an answer never applies to another
   * selection and returning to an organization shows its last answer while the new one loads. A new
   * role-grants load (the page's Retry) re-asks for the same organization, so a transient failure —
   * answered fail-closed `false` — does not stick until the selection changes.
   */
  private readonly answers: Signal<ReadonlyMap<string, boolean>> = toSignal(
    combineLatest([toObservable(this.probeUid), toObservable(this.roleGrants.loadedAtMs)]).pipe(
      distinctUntilChanged(([uidA, loadedA], [uidB, loadedB]) => uidA === uidB && loadedA === loadedB),
      switchMap(([uid]) => (uid ? this.roleGrants.editCheck(uid).pipe(map((canEdit) => [uid, canEdit] as const)) : EMPTY)),
      scan((answers, [uid, canEdit]) => new Map(answers).set(uid, canEdit), new Map<string, boolean>())
    ),
    { initialValue: new Map<string, boolean>() }
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
    return this.answers().get(uid) === true;
  });
}
