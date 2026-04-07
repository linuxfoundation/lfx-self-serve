// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { ACCOUNTS, DEV_PERSONA_PRESETS } from '@lfx-one/shared/constants';
import { Account, DevPersonaPreset, isBoardScopedPersona } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { CookieRegistryService } from '@services/cookie-registry.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { filter, map, startWith } from 'rxjs';

@Component({
  selector: 'lfx-dev-toolbar',
  imports: [ReactiveFormsModule, SelectComponent, ButtonComponent],
  templateUrl: './dev-toolbar.component.html',
  styleUrl: './dev-toolbar.component.scss',
})
export class DevToolbarComponent {
  private readonly personaService = inject(PersonaService);
  protected readonly projectContextService = inject(ProjectContextService);
  private readonly accountContextService = inject(AccountContextService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly router = inject(Router);

  // Feature flags
  protected readonly showDevToolbar = this.featureFlagService.getBooleanFlag('dev-toolbar', true);
  protected readonly showOrganizationSelector = this.featureFlagService.getBooleanFlag('organization-selector', true);

  // Organization selector options
  protected readonly availableAccounts = ACCOUNTS;

  // Dev persona presets for SelectButton
  protected readonly personaPresets = DEV_PERSONA_PRESETS;

  // Track the active preset for conditional UI
  protected readonly activePreset = signal<DevPersonaPreset>(DEV_PERSONA_PRESETS.find((p) => p.value === 'maintainer-single') ?? DEV_PERSONA_PRESETS[0]);

  /** Label for the project/foundation selector */
  protected readonly selectorLabel = computed(() => (isBoardScopedPersona(this.activePreset().primary) ? 'Foundation:' : 'Project:'));

  // Check if we're on the board dashboard page
  protected readonly isOnBoardDashboard: Signal<boolean> = this.initIsOnBoardDashboard();

  // Form for persona selector and organization selector
  public form: FormGroup;

  public constructor() {
    // Find the initial preset matching the current persona
    const currentPersona = this.personaService.currentPersona();
    const allPersonas = this.personaService.allPersonas();
    const initialPreset =
      DEV_PERSONA_PRESETS.find(
        (p) => p.primary === currentPersona && p.personas.length === allPersonas.length && p.personas.every((persona) => allPersonas.includes(persona))
      ) ?? DEV_PERSONA_PRESETS[1];
    this.activePreset.set(initialPreset);

    this.form = new FormGroup({
      persona: new FormControl<string>(initialPreset.value, [Validators.required]),
      selectedAccountId: new FormControl<string>(this.accountContextService.selectedAccount().accountId),
      selectedProjectUid: new FormControl<string>(
        isBoardScopedPersona(currentPersona)
          ? this.projectContextService.selectedFoundation()?.uid || ''
          : this.projectContextService.selectedProject()?.uid || this.projectContextService.selectedFoundation()?.uid || ''
      ),
    });

    // Subscribe to persona preset changes
    this.form
      .get('persona')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((presetValue: string) => {
        const preset = DEV_PERSONA_PRESETS.find((p) => p.value === presetValue);
        if (!preset) {
          return;
        }

        this.activePreset.set(preset);

        if (isBoardScopedPersona(preset.primary)) {
          // Board/ED: default to TLF foundation
          const tlfProject = this.projectContextService.availableProjects.find((p) => p.slug === 'tlf');
          if (tlfProject) {
            this.projectContextService.setFoundation({ uid: tlfProject.uid, name: tlfProject.name, slug: tlfProject.slug });
            this.form.get('selectedProjectUid')?.setValue(tlfProject.uid, { emitEvent: false });
          }
        } else {
          // Project-scoped: select first non-TLF project
          const firstProject = this.projectContextService.availableProjects.find((p) => p.slug !== 'tlf');
          if (firstProject) {
            this.projectContextService.setProject(firstProject);
            this.form.get('selectedProjectUid')?.setValue(firstProject.uid, { emitEvent: false });
          }
        }

        this.personaService.setPersonas(preset.primary, preset.personas, preset.multiProject ?? false, preset.multiFoundation ?? false);
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

    // Subscribe to project/foundation selection changes
    this.form
      .get('selectedProjectUid')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((uid: string) => {
        const project = this.projectContextService.availableProjects.find((p) => p.uid === uid);
        if (project) {
          if (isBoardScopedPersona(this.personaService.currentPersona())) {
            this.projectContextService.setFoundation(project);
          } else {
            this.projectContextService.setProject(project);
          }
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
        map((url) => url === '/' || url.startsWith('/?'))
      ),
      { initialValue: this.router.url === '/' }
    );
  }
}
