// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, TitleCasePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { BadgeSeverity, Committee, CommitteeMember } from '@lfx-one/shared';
import { Tooltip } from 'primeng/tooltip';

@Component({
  selector: 'lfx-member-card',
  imports: [DatePipe, TitleCasePipe, AvatarComponent, BadgeComponent, ButtonComponent, MenuComponent, Tooltip],
  templateUrl: './member-card.component.html',
})
export class MemberCardComponent {
  // Input signals
  public readonly member = input.required<CommitteeMember>();
  public readonly actionMenuItems = input.required<any[]>();
  public readonly committee = input<Committee | null>();

  // Output events
  public readonly onMenuToggle = output<{ event: Event; member: CommitteeMember; menu: MenuComponent }>();

  // Computed values
  public readonly fullName = computed(() => {
    const firstName = this.member().first_name || '';
    const lastName = this.member().last_name || '';
    return `${firstName} ${lastName}`.trim() || this.member().email || 'Member';
  });

  public readonly initials = computed(() => {
    const firstName = this.member().first_name || '';
    const lastName = this.member().last_name || '';
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    } else if (firstName) {
      return firstName.charAt(0).toUpperCase();
    } else if (this.member().email) {
      return this.member().email!.charAt(0).toUpperCase();
    }
    return 'M';
  });

  public readonly roleBadgeSeverity = computed<BadgeSeverity>(() => {
    const role = this.member().role?.name?.toLowerCase();
    if (role === 'chair' || role === 'chairperson') return 'info';
    if (role === 'vice chair' || role === 'vice-chair') return 'success';
    if (role === 'secretary') return 'contrast';
    return 'secondary';
  });

  public readonly votingStatusBadgeSeverity = computed<BadgeSeverity>(() => {
    const status = this.member().voting?.status?.toLowerCase();
    if (status === 'voting') return 'success';
    if (status === 'non-voting') return 'warn';
    return 'secondary';
  });

  public readonly enableVoting = computed(() => this.committee()?.enable_voting);

  // Event handlers
  public handleMenuToggle(event: Event, menu: MenuComponent): void {
    this.onMenuToggle.emit({ event, member: this.member(), menu });
  }
}
