// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { CombinedProfile } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { AvatarComponent } from '@shared/components/avatar/avatar.component';
import { BreadcrumbComponent } from '@shared/components/breadcrumb/breadcrumb.component';
import { MenuItem } from 'primeng/api';
import { ChipModule } from 'primeng/chip';
import { finalize } from 'rxjs';

import { ProfileStatsComponent } from './components/profile-stats/profile-stats.component';

@Component({
  selector: 'lfx-profile-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, AvatarComponent, BreadcrumbComponent, ChipModule, ProfileStatsComponent],
  templateUrl: './profile-layout.component.html',
  styleUrl: './profile-layout.component.scss',
})
export class ProfileLayoutComponent {
  private readonly userService = inject(UserService);

  // Load current user profile data
  public loading = signal<boolean>(true);

  public profile = this.initializeProfile();
  // Computed profile data
  public readonly profileTitle = this.initializeProfileTitle();
  public readonly profileSubtitle = this.initializeProfileSubtitle();
  public readonly profileLocation = this.initializeProfileLocation();
  public readonly userInitials = this.initializeUserInitials();
  public readonly memberSince = this.initializeMemberSince();
  public readonly lastActive = this.initializeLastActive();
  // Loading state

  public readonly breadcrumbItems = input<MenuItem[]>([
    {
      label: 'Home',
      routerLink: '/',
      icon: 'fa-light fa-chevron-left',
      routerLinkActiveOptions: { exact: false },
    },
  ]);

  // Menu items for profile sections
  public readonly menuItems: Signal<MenuItem[]> = this.initializeMenuItems();

  private initializeProfile(): Signal<CombinedProfile | null> {
    return toSignal(this.userService.getCurrentUserProfile().pipe(finalize(() => this.loading.set(false))), { initialValue: null });
  }

  private initializeUserInitials(): Signal<string> {
    return computed(() => {
      const profile = this.profile();
      if (!profile?.user) return '';

      const user = profile.user;
      const firstName = user.first_name;
      const lastName = user.last_name;
      const email = user.email;
      const username = user.username;

      // Priority: first/last name > username > email
      if (firstName && lastName) {
        return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
      }

      if (firstName) {
        return firstName.charAt(0).toUpperCase();
      }

      if (username) {
        return username.charAt(0).toUpperCase();
      }

      return email.charAt(0).toUpperCase();
    });
  }

  private initializeMenuItems(): Signal<MenuItem[]> {
    return computed(() => [
      {
        label: 'Edit Profile',
        icon: 'fa-light fa-user-edit text-blue-500',
        routerLink: '/profile',
        routerLinkActiveOptions: { exact: true },
      },
      {
        label: 'Password',
        icon: 'fa-light fa-key text-amber-500',
        routerLink: '/profile/password',
        routerLinkActiveOptions: { exact: true },
      },
      {
        label: 'Email Settings',
        icon: 'fa-light fa-envelope text-green-500',
        routerLink: '/profile/email',
        routerLinkActiveOptions: { exact: true },
      },
      {
        label: 'Developer Settings',
        icon: 'fa-light fa-code text-purple-500',
        routerLink: '/profile/developer',
        routerLinkActiveOptions: { exact: true },
      },
    ]);
  }

  private initializeProfileTitle(): Signal<string> {
    return computed(() => {
      const profile = this.profile();
      if (!profile?.user) return '';

      const user = profile.user;
      const firstName = user.first_name;
      const lastName = user.last_name;

      // If the user has a first name and last name, use it
      if (firstName && lastName) {
        return `${firstName} ${lastName}`;
      }

      // If the user has a first name, use it
      if (firstName) {
        return firstName;
      }

      // If the user has a username, use it
      if (user.username) {
        return user.username;
      }

      // If the user has an email, use it
      return user.email;
    });
  }

  private initializeProfileSubtitle(): Signal<string> {
    return computed(() => {
      const profile = this.profile();
      if (!profile?.profile) return '';

      return profile.profile.title || '';
    });
  }

  private initializeProfileLocation(): Signal<string> {
    return computed(() => {
      const profile = this.profile();
      if (!profile?.profile) return '';

      const parts = [];
      if (profile.profile.city) parts.push(profile.profile.city);
      if (profile.profile.state_province) parts.push(profile.profile.state_province);
      if (profile.profile.country) parts.push(profile.profile.country);

      return parts.join(', ');
    });
  }

  private initializeMemberSince(): Signal<string> {
    return computed(() => {
      const profile = this.profile();
      if (!profile?.user) return '';

      return this.calculateMemberSince(profile.user.created_at);
    });
  }

  private initializeLastActive(): Signal<string> {
    return computed(() => {
      const profile = this.profile();
      if (!profile?.user) return '';

      return this.calculateLastActive(profile.user.updated_at);
    });
  }

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
