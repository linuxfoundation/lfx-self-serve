// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { DatePipe, UpperCasePipe } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, Signal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { getMeetingHomeRowProject } from '@lfx-one/shared/utils';
import { IntercomService } from '@services/intercom.service';
import { LensService } from '@services/lens.service';
import { UserService } from '@services/user.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuSeparatorComponent } from '@shared/uikit/menu/menu-separator.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

/**
 * Sticky top bar of the standalone meeting page: the LF logo, the meeting's compact date, title and project once the page's
 * h1 scrolls under the bar, My Meetings and the account menu.
 * @description Signed-in only, like the page. The bar sticks below the impersonation banner through `--mp-offset`.
 */
@Component({
  selector: 'lfx-meeting-page-top-bar',
  imports: [
    CdkMenuTrigger,
    DatePipe,
    RouterLink,
    UiAvatarComponent,
    UiButtonComponent,
    UiMenuComponent,
    UiMenuItemComponent,
    UiMenuSeparatorComponent,
    UiTooltipDirective,
    UpperCasePipe,
  ],
  // The directive's open(), for the Support item: a keyboard-chosen menu item does not click.
  providers: [OpenIntercomDirective],
  templateUrl: './meeting-page-top-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sticky top-[var(--mp-offset,0px)] z-[10] block bg-white' },
})
export class MeetingPageTopBarComponent {
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);
  private readonly intercomService = inject(IntercomService);
  private readonly support = inject(OpenIntercomDirective);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly userService = inject(UserService);

  /** The meeting the page shows; null while it loads. */
  public readonly row = input<MeetingHomeRow | null>(null);
  /** Greys the date tile's month band for a date that has passed. */
  public readonly past = input<boolean>(false);

  /** The page has scrolled past its title, so the compact meeting line shows. */
  protected readonly scrolled = signal(false);
  protected readonly projectName: Signal<string> = computed(() => {
    const row = this.row();
    return row ? (getMeetingHomeRowProject(row.meeting)?.name ?? '') : '';
  });
  protected readonly menuPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
  ];

  public constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // The page's h1 has scrolled under the bar's bottom edge, whatever the bar's height or the banner above it.
      const onScroll = (): void => {
        const title = this.host.nativeElement.parentElement?.querySelector('main h1');
        this.scrolled.set(!!title && title.getBoundingClientRect().bottom <= this.host.nativeElement.getBoundingClientRect().bottom);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));
    });
  }

  protected openMyMeetings(): void {
    this.lensService.setLens('me');
    void this.router.navigate(['/meetings']);
  }

  protected openProfile(path: '/profile' | '/profile/settings'): void {
    this.lensService.setLens('me');
    void this.router.navigate([path]);
  }

  protected openSupport(): void {
    this.support.open();
  }

  // /logout is a server redirect, so Intercom is shut down first, as the app's other sign-out links do.
  protected signOut(): void {
    this.intercomService.shutdown();
    window.location.assign('/logout');
  }
}
