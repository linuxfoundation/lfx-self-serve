// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { environment } from '@environments/environment';
import { Formation } from '@lfx-one/shared/interfaces';
import { buildFormationAdminToolLink, formatShortDate } from '@lfx-one/shared/utils';
import { FormationService } from '@services/formation.service';
import { map, switchMap, tap } from 'rxjs';

import { WhatsNextPanelComponent } from '../propose/components/whats-next-panel/whats-next-panel.component';

/**
 * Post-submit confirmation for the Epic 1 fallback path (GH-1962). There is no real project
 * record to redirect to yet (only the fixture-backed `formation` was created — see
 * `formation.service.ts`), so this is a dedicated formation-scoped route
 * (`/propose/confirmation/:formationUid`), not the real project page.
 */
@Component({
  selector: 'lfx-propose-confirmation',
  imports: [WhatsNextPanelComponent],
  templateUrl: './propose-confirmation.component.html',
})
export class ProposeConfirmationComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly formationService = inject(FormationService);

  // Loads once per route activation; the fixture store is server-process-lifetime only, so a
  // stale/unknown uid (e.g. after a server restart) is a genuine, expected not-found case.
  public loading = signal(true);

  public readonly formation: Signal<Formation | null> = this.initFormation();

  protected readonly pccUrl = environment.urls.pcc;

  protected adminToolLink(formation: Formation): string {
    return buildFormationAdminToolLink(this.pccUrl, formation);
  }

  protected submittedOn(formation: Formation): string {
    return formatShortDate(new Date(formation.submitted_at));
  }

  private initFormation(): Signal<Formation | null> {
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
