// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { PROFILE_GRID_LIMIT, PUBLIC_PROFILE_INVOLVEMENT_COPY } from '@lfx-one/shared/constants';
import { PublicProfileInvolvementItem, PublicProfileProject } from '@lfx-one/shared/interfaces';
import { buildPublicProfileInvolvement } from '@lfx-one/shared/utils';
import { ProfileGridComponent } from '@shared/components/profile-section/profile-grid.component';
import { ProfilePillComponent } from '@shared/components/profile-section/profile-pill.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';

import { PublicProfileThemeService } from '../../services/public-profile-theme.service';

/**
 * The redesigned public profile's Foundations & projects involvement (#6093): the person's projects as pills in the profile
 * grid, nine before "View all (N)", current ones first. Hover or focus opens a card with the totals on record.
 */
@Component({
  selector: 'lfx-public-profile-involvement',
  imports: [DecimalPipe, NgTemplateOutlet, ProfileGridComponent, ProfilePillComponent, UiBadgeComponent],
  templateUrl: './public-profile-involvement.component.html',
})
export class PublicProfileInvolvementComponent {
  // Private injections
  private readonly themeService = inject(PublicProfileThemeService);

  public readonly projects = input<PublicProfileProject[]>([]);

  protected readonly copy = PUBLIC_PROFILE_INVOLVEMENT_COPY;

  // Simple WritableSignals
  protected readonly expanded = signal(false);

  // Complex computed/toSignal signals
  // The card opens outside the page, so it carries the visitor's theme itself.
  protected readonly theme = this.themeService.theme;
  protected readonly items: Signal<PublicProfileInvolvementItem[]> = this.initItems();
  protected readonly shown = computed(() => (this.expanded() ? this.items() : this.items().slice(0, PROFILE_GRID_LIMIT)));

  // Private initializer functions
  // UTC, as the server resolves the yearly rows, so a project's current year matches theirs.
  private initItems(): Signal<PublicProfileInvolvementItem[]> {
    return computed(() => buildPublicProfileInvolvement(this.projects(), new Date().getUTCFullYear()));
  }
}
