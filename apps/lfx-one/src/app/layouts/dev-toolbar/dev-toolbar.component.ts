// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { PERSONA_OPTIONS } from '@lfx-one/shared/constants';
import { PersonaType } from '@lfx-one/shared/interfaces';
import { CookieRegistryService } from '@services/cookie-registry.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';

@Component({
  selector: 'lfx-dev-toolbar',
  imports: [ReactiveFormsModule, SelectButtonComponent, ButtonComponent],
  templateUrl: './dev-toolbar.component.html',
  styleUrl: './dev-toolbar.component.scss',
})
export class DevToolbarComponent {
  private readonly personaService = inject(PersonaService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly router = inject(Router);
  // Feature flag - controls entire toolbar visibility
  protected readonly showDevToolbar = this.featureFlagService.getBooleanFlag('dev-toolbar', true);

  // Persona options for SelectButton
  protected readonly personaOptions = PERSONA_OPTIONS;

  // Form for persona selector
  public form: FormGroup;

  public constructor() {
    this.form = new FormGroup({
      persona: new FormControl<PersonaType>(this.personaService.currentPersona(), [Validators.required]),
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
}
