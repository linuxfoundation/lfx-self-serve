// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, SlicePipe, UpperCasePipe } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { HeaderComponent } from '@components/header/header.component';
import { TagComponent } from '@components/tag/tag.component';
import { JOIN_MODE_LABELS } from '@lfx-one/shared/constants';
import { PublicGroupDetail } from '@lfx-one/shared/interfaces';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { GroupService } from '@services/group.service';
import { UserService } from '@services/user.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, filter, map, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-group-detail',
  imports: [
    SlicePipe,
    UpperCasePipe,
    RouterLink,
    ButtonComponent,
    CardComponent,
    ExpandableTextComponent,
    HeaderComponent,
    TagComponent,
    MeetingTimePipe,
    SkeletonModule,
  ],
  templateUrl: './group-detail.component.html',
})
export class GroupDetailComponent {
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly groupService = inject(GroupService);
  protected readonly userService = inject(UserService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly authenticated = this.userService.authenticated;
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly group: Signal<PublicGroupDetail | null> = this.initGroup();

  protected readonly joinModeLabel = computed(() => {
    const mode = this.group()?.join_mode;
    return mode ? JOIN_MODE_LABELS[mode] : null;
  });

  protected readonly joinModeIcon = computed(() => {
    const mode = this.group()?.join_mode;
    switch (mode) {
      case 'open':
        return 'fa-light fa-door-open';
      case 'application':
        return 'fa-light fa-file-lines';
      case 'invite_only':
        return 'fa-light fa-envelope';
      case 'closed':
        return 'fa-light fa-lock';
      default:
        return null;
    }
  });

  protected readonly hasLinks = computed(() => {
    const links = this.group()?.links;
    return !!(links?.website || links?.mailing_list || links?.chat_channel || links?.calendar);
  });

  protected readonly hasUpcomingMeetings = computed(() => (this.group()?.upcoming_meetings?.length ?? 0) > 0);

  protected readonly memberRoleLabel = computed(() => {
    const role = this.group()?.my_role;
    if (role === 'Chair' || role === 'Vice Chair') {
      return `a ${role.toLowerCase()}`;
    }
    return 'a member';
  });

  protected navigateToLogin(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
    }
  }

  private initGroup(): Signal<PublicGroupDetail | null> {
    return toSignal(
      this.activatedRoute.paramMap.pipe(
        map((params) => params.get('id')),
        filter((id): id is string => !!id),
        distinctUntilChanged(),
        switchMap((id) => {
          this.loading.set(true);
          this.error.set(false);
          return this.groupService.getPublicGroup(id).pipe(
            catchError((err) => {
              if ([400, 403, 404].includes(err.status)) {
                this.router.navigate(['/groups/not-found']);
              } else {
                this.error.set(true);
              }
              this.loading.set(false);
              return of(null);
            })
          );
        }),
        map((group) => {
          this.loading.set(false);
          return group;
        })
      ),
      { initialValue: null }
    );
  }
}
