// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { afterNextRender, Component, computed, inject, input, signal, Signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { ChangelogDrawerComponent } from '@components/changelog-drawer/changelog-drawer.component';
import { ImpersonationDialogComponent } from '@components/impersonation-dialog/impersonation-dialog.component';
import { LENS_DEFAULT_ROUTES } from '@lfx-one/shared/constants';
import { Lens } from '@lfx-one/shared/interfaces';
import { buildInsightsUrl, isDocsPath } from '@lfx-one/shared/utils';
import { ChangelogService } from '@services/changelog.service';
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

  public readonly mobile = input<boolean>(false);

  protected readonly activeLens = this.lensService.activeLens;
  protected readonly lenses = this.lensService.displayLenses;
  protected readonly isHybrid = this.lensService.isHybridPersona;
  // Hybrid personas merge the 'project' button with the 'foundation' lens state — both map to 'project' for highlighting.
  protected readonly activeLensId: Signal<Lens> = computed(() => {
    const active = this.activeLens();
    return this.isHybrid() && active === 'foundation' ? 'project' : active;
  });
  protected readonly user = this.userService.user;
  protected readonly insightsUrl = buildInsightsUrl();
  protected readonly userMenu = viewChild<Popover>('userMenu');

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
    this.lensService.setLens(lens);
    this.router.navigate([LENS_DEFAULT_ROUTES[lens]]);
  }

  protected toggleUserMenu(event: Event): void {
    this.userMenu()?.toggle(event);
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
