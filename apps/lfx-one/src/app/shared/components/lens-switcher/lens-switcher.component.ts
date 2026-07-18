// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { afterNextRender, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { ChangelogDrawerComponent } from '@components/changelog-drawer/changelog-drawer.component';
import { CreateArtifactDialogComponent } from '@components/create-artifact-dialog/create-artifact-dialog.component';
import { ImpersonationDialogComponent } from '@components/impersonation-dialog/impersonation-dialog.component';
import { environment } from '@environments/environment';
import { CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import { CreatableArtifactConfig, Lens } from '@lfx-one/shared/interfaces';
import { buildInsightsUrl, isDocsPath } from '@lfx-one/shared/utils';
import { ChangelogService } from '@services/changelog.service';
import { CreatePermissionService } from '@services/create-permission.service';
import { LensService } from '@services/lens.service';
import { UserService } from '@services/user.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { DialogService } from 'primeng/dynamicdialog';
import { Popover, PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';
import { filter, map, startWith } from 'rxjs';

@Component({
  selector: 'lfx-lens-switcher',
  imports: [NgClass, RouterLink, TooltipModule, PopoverModule, AvatarComponent, ButtonComponent, ChangelogDrawerComponent, OpenIntercomDirective],
  providers: [DialogService],
  templateUrl: './lens-switcher.component.html',
  styleUrl: './lens-switcher.component.scss',
})
export class LensSwitcherComponent {
  private readonly lensService = inject(LensService);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly dialogService = inject(DialogService);
  private readonly changelogService = inject(ChangelogService);
  protected readonly createPermissionService = inject(CreatePermissionService);

  public readonly mobile = input<boolean>(false);
  /**
   * Whether the host layout shifts the rail down to clear a banner. Only `main-layout` does
   * (`top-12` under impersonation); the docs shell pins the rail at `top-0` and renders no
   * banner. The Create popover is appended to body and top-anchored, so it can't infer the
   * rail's offset — the layout that applies the shift has to declare it.
   */
  public readonly bannerOffset = input<boolean>(false);
  /** Render the vertical lens buttons in the rail. Every current caller (main layout desktop + mobile, docs shell) passes `false` since lenses live in the sidebar tabs; the `true` default is only a standalone-reuse fallback. */
  public readonly showLensButtons = input<boolean>(true);

  protected readonly lenses = this.lensService.displayLenses;
  // Hybrid personas merge the 'project' button with the 'foundation' lens state — both map to 'project' for highlighting.
  protected readonly activeLensId = this.lensService.displayActiveLens;
  protected readonly user = this.userService.user;
  protected readonly insightsUrl = buildInsightsUrl();
  protected readonly crowdfundingUrl = environment.urls.crowdfunding;
  protected readonly mentorshipUrl = environment.urls.mentorship;
  protected readonly userMenu = viewChild<Popover>('userMenu');
  protected readonly appsMenu = viewChild<Popover>('appsMenu');
  protected readonly createMenu = viewChild<Popover>('createMenu');

  // Only offer artifact types the user can actually create somewhere (mirrors the rail button's visibility gate).
  protected readonly creatableArtifacts = computed<CreatableArtifactConfig[]>(() =>
    CREATABLE_ARTIFACTS.filter((artifact) => this.createPermissionService.creatableTypes().includes(artifact.type))
  );

  /**
   * Tracks whether the active route is anywhere under `/docs/*` so the docs
   * icon can render its active-pill state. Subscribes to NavigationEnd and
   * seeds the initial value from `router.url` so SSR and the first render
   * agree.
   */
  protected readonly isDocsActive = this.initIsDocsActive();

  protected readonly userInitials = this.userService.userInitials;
  protected readonly canImpersonate = this.userService.canImpersonate;
  protected readonly isImpersonating = this.userService.impersonating;
  protected readonly unseenChangelogCount = this.changelogService.unseenChangelogCount;
  protected readonly changelogDrawerVisible = signal(false);
  protected readonly changelogAriaLabel = computed(() => {
    const count = this.unseenChangelogCount();
    if (count === 0) return "What's New";
    return `What's New (${count} unseen ${count === 1 ? 'update' : 'updates'})`;
  });

  public constructor() {
    // afterNextRender so input bindings have settled — the duplicate `[mobile]="true"` instance correctly skips.
    afterNextRender(() => {
      if (this.mobile()) {
        return;
      }
      this.changelogService.loadUnseenCount();
    });
  }

  protected setLens(lens: Lens): void {
    this.userMenu()?.hide();
    this.lensService.switchLens(lens);
  }

  protected toggleUserMenu(event: Event): void {
    this.userMenu()?.toggle(event);
  }

  protected toggleAppsMenu(event: Event): void {
    this.appsMenu()?.toggle(event);
  }

  protected navigateToProfile(): void {
    this.userMenu()?.hide();
    this.lensService.setLens('me');
    this.router.navigate(['/profile']);
  }

  protected openImpersonationDialog(): void {
    this.dialogService.open(ImpersonationDialogComponent, {
      header: 'Impersonate User',
      width: '400px',
      modal: true,
      draggable: false,
      resizable: false,
    });
  }

  protected toggleCreateMenu(event: Event): void {
    this.createMenu()?.toggle(event);
  }

  protected openCreateDialog(artifact: CreatableArtifactConfig): void {
    this.createMenu()?.hide();
    this.dialogService.open(CreateArtifactDialogComponent, {
      // No PrimeNG header — the dialog body renders its own "Create <Type>" header.
      showHeader: false,
      // Name the role="dialog" for assistive tech: with showHeader:false PrimeNG emits no
      // generated title, so point ariaLabelledBy at the body's own <h2 id="create-artifact-heading">.
      ariaLabelledBy: 'create-artifact-heading',
      width: '480px',
      // Uniform padding all around — PrimeNG's default content padding zeroes the top
      // (normally supplied by the header we removed), so set it explicitly here.
      contentStyle: { padding: '1.5rem' },
      modal: true,
      draggable: false,
      resizable: false,
      dismissableMask: true,
      data: { type: artifact.type },
    });
  }

  protected openChangelogDrawer(): void {
    this.changelogDrawerVisible.set(true);
  }

  private initIsDocsActive() {
    return toSignal(
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map((event) => isDocsPath(event.urlAfterRedirects)),
        startWith(isDocsPath(this.router.url))
      ),
      { requireSync: true }
    );
  }
}
