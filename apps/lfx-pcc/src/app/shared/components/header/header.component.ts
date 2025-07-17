import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AvatarComponent } from '@app/shared/components/avatar/avatar.component';
import { MenubarComponent } from '@app/shared/components/menubar/menubar.component';
import { UserService } from '@app/shared/services/user.service';
import { environment } from '@environments/environment';
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
})
export class HeaderComponent {
  private readonly router = inject(Router);
  public readonly userService = inject(UserService);

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
      url: environment.urls.profile + '/developer-settings',
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
}
