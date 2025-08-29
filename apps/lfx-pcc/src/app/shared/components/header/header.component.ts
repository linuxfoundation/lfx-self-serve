// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, inject, Signal, signal, viewChild, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { MenubarComponent } from '@components/menubar/menubar.component';
import { environment } from '@environments/environment';
import { Project } from '@lfx-pcc/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MenuItem } from 'primeng/api';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { RippleModule } from 'primeng/ripple';
import { of, catchError, debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs';

import { AutocompleteComponent } from '../autocomplete/autocomplete.component';
import { MenuComponent } from '../menu/menu.component';

@Component({
  selector: 'lfx-header',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MenubarComponent, RippleModule, RouterModule, AvatarComponent, MenuComponent, AutocompleteComponent],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  // TODO: Remove ngSkipHydration when upgrading to Angular 20 - zoneless hydration compatibility
  // https://github.com/angular/angular/issues/50543
  host: { ngSkipHydration: 'true' },
})
export class HeaderComponent {
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectService);
  public readonly userService = inject(UserService);

  // Mobile search state
  public showMobileSearch: WritableSignal<boolean> = signal(false);
  private readonly mobileSearchInput = viewChild<ElementRef>('mobileSearchInput');

  // Search form
  protected readonly searchForm = new FormGroup({
    search: new FormControl(''),
  });

  // Initialize suggestions as a signal based on search query changes
  protected suggestions: Signal<Project[]>;

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

  public constructor() {
    // Initialize suggestions signal that reacts to search query changes
    const searchResults$ = this.searchForm.get('search')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((searchTerm: string | null) => {
        const trimmedTerm = searchTerm?.trim() || '';

        // Only fetch suggestions when user types something
        if (!trimmedTerm) {
          return of([]);
        }

        return this.projectService.searchProjects(trimmedTerm);
      }),
      catchError((error) => {
        console.error('Error searching projects:', error);
        return of([]);
      })
    );

    this.suggestions = toSignal(searchResults$, {
      initialValue: [],
    });
  }

  protected onSearchComplete(event: AutoCompleteCompleteEvent): void {
    // Update the search form value which will trigger the observable
    this.searchForm.get('search')?.setValue(event.query);
  }

  protected onProjectSelect(event: AutoCompleteSelectEvent): void {
    const project = event.value;
    if (project) {
      this.searchForm.get('search')?.setValue('');
      this.closeMobileSearch();
      this.router.navigate(['/project', project.slug]);
    }
  }

  protected onSearchClear(): void {
    this.searchForm.get('search')?.setValue('');
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
