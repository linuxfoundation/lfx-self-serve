// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { CombinedProfile, UserStatistics } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-profile-stats',
  standalone: true,
  imports: [CommonModule, CardComponent],
  templateUrl: './profile-stats.component.html',
  styleUrl: './profile-stats.component.scss',
})
export class ProfileStatsComponent {
  // Input profile data
  public readonly profile = input<CombinedProfile | null>(null);

  // Computed statistics
  public readonly statistics: Signal<UserStatistics | null> = computed(() => {
    const profileData = this.profile();
    if (!profileData?.user) return null;

    return {
      committees: 5, // Mock data
      meetings: 23, // Mock data
      contributions: 147, // Mock data
      activeProjects: 3, // Mock data
      memberSince: this.calculateMemberSince(profileData.user.created_at),
      lastActive: this.calculateLastActive(profileData.user.updated_at),
    };
  });

  /**
   * Calculate how long the user has been a member
   */
  private calculateMemberSince(createdAt: string): string {
    const created = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - created.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 30) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months === 1 ? '' : 's'}`;
    }

    const years = Math.floor(diffDays / 365);
    const remainingMonths = Math.floor((diffDays % 365) / 30);
    if (remainingMonths > 0) {
      return `${years} year${years === 1 ? '' : 's'}, ${remainingMonths} month${remainingMonths === 1 ? '' : 's'}`;
    }
    return `${years} year${years === 1 ? '' : 's'}`;
  }

  /**
   * Calculate last active time
   */
  private calculateLastActive(updatedAt: string): string {
    const updated = new Date(updatedAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - updated.getTime());
    const diffMinutes = Math.floor(diffTime / (1000 * 60));
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else if (diffDays < 30) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months === 1 ? '' : 's'} ago`;
    }

    const years = Math.floor(diffDays / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  }
}
