// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MentorshipMenteePhase } from '@lfx-one/shared/interfaces';
import { filter } from 'rxjs';

import { MenteeAcceptedTasksComponent } from '../mentee-accepted-tasks/mentee-accepted-tasks.component';
import { MenteeApplicantTasksComponent } from '../mentee-applicant-tasks/mentee-applicant-tasks.component';

/**
 * My Application Tasks / My Tasks tab — a thin phase orchestrator. It renders the
 * phase-specific child that owns its own data, forms, and actions:
 *
 * - **applicant** — `MenteeApplicantTasksComponent` (prerequisite tasks by application)
 * - **accepted** — `MenteeAcceptedTasksComponent` (flat task list with status filter)
 *
 * ## Phase resolution
 *
 * The shell (`MenteePageComponent`) owns the phase: the overview child reports it
 * via `phaseChange`, and the shell pushes it into this component's `phase` signal
 * on activation. That value is authoritative — trusting it (rather than
 * re-fetching the overview) keeps the tab in sync with the phase the user actually
 * selected, e.g. the dev phase switcher on the overview.
 *
 * A cold deep-link or refresh directly on `/mentorship/mentee/tasks` arrives with
 * the shell's default `empty` phase — there is no tasks tab in that phase — so this
 * component redirects to the overview, which resolves the real phase and restores
 * the correct tab bar.
 */
@Component({
  selector: 'lfx-mentorship-mentee-application-tasks',
  imports: [RouteLoadingComponent, MenteeApplicantTasksComponent, MenteeAcceptedTasksComponent],
  templateUrl: './mentee-application-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeApplicationTasksComponent {
  // ---- 1. DI ----------------------------------------------------------------
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  // ---- 2. Simple writable signals -------------------------------------------
  /**
   * Authoritative phase, pushed by the shell on activation. Defaults to `empty`
   * so a cold deep-link (no overview resolved yet) redirects to the overview.
   */
  public readonly phase = signal<MentorshipMenteePhase>('empty');

  // ---- 3. Complex computed signals ------------------------------------------
  /** The phase this tab renders — the shell's authoritative value. */
  protected readonly resolvedPhase = computed<MentorshipMenteePhase>(() => this.phase());

  public constructor() {
    this.initEmptyPhaseRedirect();
  }

  // ---- 4. Private initializers ----------------------------------------------

  /**
   * The tasks route has no place in the empty phase (no tab exists), so bounce
   * to the overview, which resolves the real phase and restores the tab bar.
   * Uses an RxJS subscription rather than `effect()` (frontend-checklist §5),
   * and only in the browser — SSR must not navigate.
   */
  private initEmptyPhaseRedirect(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    toObservable(this.resolvedPhase)
      .pipe(
        filter((p) => p === 'empty'),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        void this.router.navigate(['/mentorship/mentee/overview']);
      });
  }
}
