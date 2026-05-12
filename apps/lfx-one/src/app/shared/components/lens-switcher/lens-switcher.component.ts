// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { afterNextRender, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { ChangelogDrawerComponent } from '@components/changelog-drawer/changelog-drawer.component';
import { ImpersonationDialogComponent } from '@components/impersonation-dialog/impersonation-dialog.component';
import { LENS_DEFAULT_ROUTES } from '@lfx-one/shared/constants';
import { Lens } from '@lfx-one/shared/interfaces';
import { buildInsightsUrl } from '@lfx-one/shared/utils';
import { ChangelogService } from '@services/changelog.service';
import { LensService } from '@services/lens.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { Popover, PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-lens-switcher',
  imports: [NgClass, RouterLink, TooltipModule, PopoverModule, AvatarComponent, ButtonComponent, ChangelogDrawerComponent],
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
  protected readonly lenses = this.lensService.availableLenses;
  protected readonly user = this.userService.user;
  protected readonly insightsUrl = buildInsightsUrl();
  protected readonly userMenu = viewChild<Popover>('userMenu');

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
}
