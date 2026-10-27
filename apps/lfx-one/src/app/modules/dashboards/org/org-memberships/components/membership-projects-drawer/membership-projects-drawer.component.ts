// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  type AfterRenderRef,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrgLensMembershipsService } from '@app/shared/services/org-lens-memberships.service';
import { OrgLensNavigationService } from '@app/shared/services/org-lens-navigation.service';
import type { OrgMembershipProject } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { catchError, finalize, of, switchMap } from 'rxjs';

/**
 * Side panel behind the Org Projects count on the active-memberships table: the projects the org
 * is involved in for one foundation. The BFF reads the same detail model the count is rolled up
 * from, so the row count here always matches the number the user clicked.
 */
@Component({
  selector: 'lfx-membership-projects-drawer',
  imports: [FormsModule, RouterLink, DrawerModule, InputTextModule, DecimalPipe],
  templateUrl: './membership-projects-drawer.component.html',
})
export class MembershipProjectsDrawerComponent {
  private readonly membershipsService = inject(OrgLensMembershipsService);
  private readonly orgLens = inject(OrgLensNavigationService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);

  public readonly visible = model<boolean>(false);
  public readonly orgUid = input<string>('');
  public readonly foundationId = input<string>('');
  public readonly foundationName = input<string>('');
  public readonly count = input<number>(0);

  protected readonly searchTerm = signal('');
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly retryTrigger = signal(0);

  private readonly projectsData = this.initProjectsData();

  protected readonly filteredProjects = computed<OrgMembershipProject[]>(() => this.initFilteredProjects());

  // PrimeNG moves the real panel to document.body, so it is not a child of this component's host —
  // this is a template ref into our own #header ng-template, which PrimeNG embeds into that panel.
  private readonly titleRef = viewChild<ElementRef<HTMLHeadingElement>>('titleRef');
  private previouslyFocusedElement: HTMLElement | null = null;

  // Gates the live region's real text (see statusMessage() and the template). Reset to false on
  // every close (initProjectsData()'s !visible branch — the one path every close goes through),
  // not on show: PrimeNG's onShow fires after the panel node is already inserted for that open, so
  // resetting only there would leave a stale `true` from the previous open sitting on the first
  // paint of every reopen. Flips true via afterNextRender(), so the real text always arrives as a
  // mutation on an already-painted node — which is what makes it announce.
  protected readonly contentRevealed = signal(false);
  private revealRef: AfterRenderRef | null = null;

  // Text for the sr-only live region. Lives inside <p-drawer>'s content deliberately: the panel is
  // aria-modal="true", and AT treats content outside an open modal's subtree as unreachable, so a
  // hoisted sibling region would be announced unreliably. Being inside means the node is destroyed
  // and recreated on every open — contentRevealed handles what that implies. Covers every state
  // transition a Retry click can cause (failure -> success, or failure -> failure again), where the
  // visible content looks identical without reading it.
  protected readonly statusMessage = computed<string>(() => {
    if (this.loading()) return 'Loading projects…';
    if (this.loadFailed()) return 'Unable to load projects.';
    const count = this.projectsData()?.projects.length ?? 0;
    return `${count} project${count === 1 ? '' : 's'} loaded.`;
  });

  // p-drawer never moves focus into the panel on open, nor restores it on close; it only traps Tab
  // once focus is already inside. Capture the trigger before moving focus in, so (onHide) can hand
  // it back. (onHide) fires for Escape and the close button, not for a programmatic
  // `visible.set(false)` — on an org switch, or when a project link navigates away, the trigger is
  // gone and restoring focus to it would mean nothing.
  protected onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.titleRef()?.nativeElement.focus();

    // Belt-and-braces, not the sole guarantee — see contentRevealed's own comment.
    this.contentRevealed.set(false);
    this.revealRef?.destroy();
    this.revealRef = afterNextRender(() => this.contentRevealed.set(true), { injector: this.injector });
  }

  protected onDrawerHide(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.previouslyFocusedElement?.isConnected) {
      this.previouslyFocusedElement.focus();
    }
    this.previouslyFocusedElement = null;
  }

  protected projectLink(project: OrgMembershipProject): string[] {
    return this.orgLens.orgLensLink('projects', project.projectSlug || project.projectId);
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  private initFilteredProjects(): OrgMembershipProject[] {
    const term = this.searchTerm().toLowerCase().trim();
    const projects = this.projectsData()?.projects ?? [];
    if (!term) return projects;
    return projects.filter((p) => p.projectName.toLowerCase().includes(term));
  }

  private initProjectsData() {
    // Keyed off the full target rather than `visible` alone so the list refreshes when the row
    // behind the panel changes (e.g. the org switches) while the panel stays open.
    const trigger$ = toObservable(
      computed(() => ({
        visible: this.visible(),
        orgUid: this.orgUid(),
        foundationId: this.foundationId(),
        retry: this.retryTrigger(),
      }))
    );

    return toSignal(
      trigger$.pipe(
        switchMap(({ visible, orgUid, foundationId }) => {
          if (!visible || !orgUid || !foundationId) {
            // The one path every close goes through, unlike (onHide) — see contentRevealed's
            // comment. Destroys any pending reveal too, so a programmatic close can't have its
            // afterNextRender callback fire afterwards and re-set contentRevealed to true.
            this.contentRevealed.set(false);
            this.revealRef?.destroy();
            this.revealRef = null;
            return of(null);
          }
          this.searchTerm.set('');
          this.loading.set(true);
          this.loadFailed.set(false);
          return this.membershipsService.getFoundationProjects(orgUid, foundationId).pipe(
            catchError(() => {
              this.loadFailed.set(true);
              return of({ accountId: orgUid, foundationId, projects: [] });
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
