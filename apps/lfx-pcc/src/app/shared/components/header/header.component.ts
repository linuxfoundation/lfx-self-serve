// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, inject, signal, viewChild, WritableSignal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { MenubarComponent } from '@components/menubar/menubar.component';
import { environment } from '@environments/environment';
import { UserService } from '@services/user.service';
import { MenuItem } from 'primeng/api';
import { InputTextModule } from 'primeng/inputtext';
import { RippleModule } from 'primeng/ripple';

import { MenuComponent } from '../menu/menu.component';

@Component({
  selector: 'lfx-header',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MenubarComponent, InputTextModule, RippleModule, RouterModule, AvatarComponent, MenuComponent],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  // TODO: Remove ngSkipHydration when upgrading to Angular 20 - zoneless hydration compatibility
  // https://github.com/angular/angular/issues/50543
  host: { ngSkipHydration: 'true' },
})
export class HeaderComponent {
  private readonly router = inject(Router);
  public readonly userService = inject(UserService);

  // Mobile search state
  public showMobileSearch: WritableSignal<boolean> = signal(false);
  private readonly mobileSearchInput = viewChild<ElementRef>('mobileSearchInput');

  // User menu items for the dropdown
  protected readonly userMenuItems: MenuItem[] = [
    {
      label: 'Profile',
      icon: 'fa-light fa-user',
      url: environment.urls.profile,
      target: '_blank',
    },
    {
      label: 'Developer Settings',
      icon: 'fa-light fa-cog',
      url: environment.urls.profile + 'developer-settings',
      target: '_blank',
    },
    {
      separator: true,
    },
    {
      label: 'Logout',
      icon: 'fa-light fa-sign-out',
      url: '/logout',
      target: '_self',
    },
  ];

  protected readonly searchControl = new FormControl('');

  protected onSearch(): void {
    const query = this.searchControl.value?.trim();
    if (query) {
      // TODO: Implement search functionality
    }
  }

  protected onLogoClick(): void {
    this.router.navigate(['/']);
  }

  protected onUserClick(): void {
    // TODO: Show user menu/dropdown or navigate to profile
    console.info('User avatar clicked');
  }

  protected toggleMobileSearch(): void {
    this.showMobileSearch.set(true);
    // Focus on input after opening
    setTimeout(() => {
      const input = this.mobileSearchInput();
      if (input) {
        input.nativeElement.focus();
      }
    }, 100);
  }

  protected closeMobileSearch(): void {
    this.showMobileSearch.set(false);
  }
}
