// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '@environments/environment';
import { Formation } from '@lfx-one/shared/interfaces';
import { buildFormationAdminToolLink, formatShortDate } from '@lfx-one/shared/utils';
import { FormationService } from '@services/formation.service';
import { PersonaService } from '@services/persona.service';
import { map, switchMap, tap } from 'rxjs';

import { WhatsNextPanelComponent } from '../components/whats-next-panel/whats-next-panel.component';

/**
 * Post-submit confirmation for the Epic 1 fallback path (GH-1962). There is no real project
 * record to redirect to yet (only the fixture-backed `formation` was created — see
 * `formation.service.ts`), so this is a dedicated formation-scoped route
 * (`/propose/confirmation/:formationUid`), not the real project page.
 *
 * The formation is read from router state first (`ProposeComponent.onSubmit`'s `router.navigate`
 * call), the same pattern `committee-view.component.ts` uses for `backLabel` — this is the
 * primary path, since the fixture store is per-pod (multiple replicas) and a follow-up GET can
 * land on a pod that never saw the POST. The GET-by-uid fallback below only runs for a direct or
 * refreshed link, where no navigation state exists.
 */
@Component({
  selector: 'lfx-propose-confirmation',
  imports: [WhatsNextPanelComponent],
  templateUrl: './propose-confirmation.component.html',
})
export class ProposeConfirmationComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formationService = inject(FormationService);
  private readonly personaService = inject(PersonaService);

  public loading = signal(true);

  public readonly formation: Signal<Formation | null> = this.initFormation();

  /** The "Create in admin tool" CTA names an internal staff workflow — hide it (and the fixture's
   *  "Staff only" framing) from an ordinary proposer landing on their own confirmation page. No
   *  `formation_admin` FGA check exists in this repo yet (#1955/#1958 will add one); reuses
   *  `PersonaService.canViewExecutiveDashboards` (the same "EDs and LF Staff" predicate Foundation
   *  Health / Marketing Overview / Social Listening gate on) rather than re-deriving it, plus a
   *  local `personaLoaded` gate that signal doesn't have — `isLFStaff`/`currentPersona` populate
   *  from an async fetch, so reading them before it resolves would show a staff viewer the
   *  proposer-safe copy for a moment; failing closed until loaded is the safe direction. */
  protected readonly isStaffOrExecutiveDirector: Signal<boolean> = computed(
    () => this.personaService.personaLoaded() && this.personaService.canViewExecutiveDashboards()
  );

  protected readonly submittedOnLabel: Signal<string> = computed(() => {
    const formation = this.formation();
    return formation ? formatShortDate(new Date(formation.submitted_at)) : '';
  });

  protected readonly adminToolLink: Signal<string> = computed(() => {
    const formation = this.formation();
    return formation ? buildFormationAdminToolLink(environment.urls.pcc, formation) : '';
  });

  private initFormation(): Signal<Formation | null> {
    const navigationFormation = this.router.getCurrentNavigation()?.extras?.state?.['formation'] as Formation | undefined;
    if (navigationFormation) {
      this.loading.set(false);
      return signal<Formation | null>(navigationFormation);
    }

    return toSignal(
      this.route.paramMap.pipe(
        map((params) => params.get('formationUid')),
        tap(() => this.loading.set(true)),
        switchMap((uid) => (uid ? this.formationService.getFormationByUid(uid) : [null])),
        tap(() => this.loading.set(false)),
        takeUntilDestroyed()
      ),
      { initialValue: null }
    );
  }
}
