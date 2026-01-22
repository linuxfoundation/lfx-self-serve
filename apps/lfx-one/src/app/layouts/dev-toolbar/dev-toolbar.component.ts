// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SelectComponent } from '@components/select/select.component';
import { ACCOUNTS, PERSONA_OPTIONS } from '@lfx-one/shared/constants';
import { Account, PersonaType } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { CookieRegistryService } from '@services/cookie-registry.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { filter, map, startWith } from 'rxjs';

@Component({
  selector: 'lfx-dev-toolbar',
  imports: [ReactiveFormsModule, SelectButtonComponent, SelectComponent, ButtonComponent],
  templateUrl: './dev-toolbar.component.html',
  styleUrl: './dev-toolbar.component.scss',
})
export class DevToolbarComponent {
  private readonly personaService = inject(PersonaService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly accountContextService = inject(AccountContextService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly router = inject(Router);

  // Feature flags
  protected readonly showDevToolbar = this.featureFlagService.getBooleanFlag('dev-toolbar', true);
  protected readonly showOrganizationSelector = this.featureFlagService.getBooleanFlag('organization-selector', true);

  // Organization selector options
  protected readonly availableAccounts = ACCOUNTS;

  // Persona options for SelectButton
  protected readonly personaOptions = PERSONA_OPTIONS;

  // Check if we're on the board dashboard page
  protected readonly isOnBoardDashboard: Signal<boolean> = this.initIsOnBoardDashboard();

  // Form for persona selector and organization selector
  public form: FormGroup;

  public constructor() {
    this.form = new FormGroup({
      persona: new FormControl<PersonaType>(this.personaService.currentPersona(), [Validators.required]),
      selectedAccountId: new FormControl<string>(this.accountContextService.selectedAccount().accountId),
    });

    // Subscribe to persona changes
    this.form
      .get('persona')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value: PersonaType) => {
        if (value === 'board-member') {
          // TODO: DEMO - Remove when proper permissions are implemented
          const tlfProject = this.projectContextService.availableProjects.find((p) => p.slug === 'tlf');
          if (tlfProject) {
            this.projectContextService.setFoundation({
              uid: tlfProject.uid,
              name: tlfProject.name,
              slug: tlfProject.slug,
            });
          }
        } else {
          // Navigate to the first project in the list that is not the TLF project
          const firstProject = this.projectContextService.availableProjects.find((p) => p.slug !== 'tlf');
          if (firstProject) {
            this.projectContextService.setProject(firstProject);
          }
        }

        this.personaService.setPersona(value);
      });

    // Subscribe to account selection changes
    this.form
      .get('selectedAccountId')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        const selectedAccount = ACCOUNTS.find((acc) => acc.accountId === value);
        if (selectedAccount) {
          this.accountContextService.setAccount(selectedAccount as Account);
        }
      });
  }

  /**
   * Clear all LFX-related cookies and refresh the page
   * Uses the cookie registry to clear all tracked cookies
   */
  protected clearCache(): void {
    this.cookieRegistry.clearAllCookies();

    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  private initIsOnBoardDashboard(): Signal<boolean> {
    return toSignal(
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map((event) => event.urlAfterRedirects),
        startWith(this.router.url),
        map((url) => url === '/' || url === '/dashboard' || url.startsWith('/dashboard?') || url.startsWith('/?'))
      ),
      { initialValue: this.router.url === '/' || this.router.url === '/dashboard' }
    );
  }
}
