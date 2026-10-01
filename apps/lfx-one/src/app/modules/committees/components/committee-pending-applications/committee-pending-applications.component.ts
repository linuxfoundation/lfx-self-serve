// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, InputSignal, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyPendingApplication } from '@lfx-one/shared/interfaces';
import { getEntityCommands } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { of, switchMap, take } from 'rxjs';

/**
 * "Pending Applications" section shown between the Invitations section and the My Groups table
 * on the Me lens. Fetches the caller's own cross-committee pending applications once the Me
 * lens activates in the browser, then renders nothing when the filtered list is empty.
 *
 * Accepts `myCommitteeUids` so it can exclude any group the user is already a member of —
 * preventing a race where an approved application briefly appears in both this section and
 * the main My Groups list.
 */
@Component({
  selector: 'lfx-committee-pending-applications',
  imports: [ButtonComponent, TagComponent, RouterLink, DatePipe],
  templateUrl: './committee-pending-applications.component.html',
  styleUrl: './committee-pending-applications.component.scss',
})
export class CommitteePendingApplicationsComponent {
  // ── Injections ──────────────────────────────────────────────────────────────
  private readonly committeeService = inject(CommitteeService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs ────────────────────────────────────────────────────────────────
  /**
   * UIDs of groups the caller is already a member of (from the parent dashboard's
   * `myCommitteeUids` signal). Applications whose `committee_uid` is in this set are
   * suppressed so a group never shows in both the Pending Applications and My Groups sections.
   */
  public readonly myCommitteeUids: InputSignal<Set<string>> = input.required<Set<string>>();

  // ── Data ──────────────────────────────────────────────────────────────────
  private readonly allApplications: Signal<MyPendingApplication[]> = this.initApplications();

  /**
   * Applications filtered to exclude any committee the user is already a member of.
   * Pre-computed so the template is binding-only.
   */
  public readonly applications: Signal<MyPendingApplication[]> = computed(() => {
    const memberUids = this.myCommitteeUids();
    return this.allApplications().filter((app) => !memberUids.has(app.committee_uid));
  });

  /**
   * Each application decorated with its canonical view link (mirrors CommitteeInvitationsComponent).
   */
  protected readonly applicationRows = computed(() =>
    this.applications().map((app) => ({
      ...app,
      viewCommands: getEntityCommands('groups', app.committee_uid, app.is_foundation) ?? ['/groups', app.committee_uid],
      viewQueryParams: app.project_slug ? { project: app.project_slug } : ({} as Record<string, string>),
    }))
  );

  // ── Private helpers ───────────────────────────────────────────────────────
  private initApplications(): Signal<MyPendingApplication[]> {
    if (!isPlatformBrowser(this.platformId)) {
      return signal([]);
    }

    // Load once when the component first renders in the browser. The parent dashboard already
    // gates this component to the Me-lens-only block, but we guard here too so the service
    // call never fires on SSR or in non-Me contexts if the component is ever reused.
    return toSignal(
      of(true).pipe(
        take(1),
        switchMap(() => this.committeeService.getMyApplications()),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: [] }
    );
  }
}
