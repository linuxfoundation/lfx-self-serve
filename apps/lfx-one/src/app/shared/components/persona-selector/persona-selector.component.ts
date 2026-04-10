// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SelectComponent } from '@components/select/select.component';
import { PERSONA_OPTIONS } from '@lfx-one/shared/constants';
import { PersonaType } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';

@Component({
  selector: 'lfx-persona-selector',
  imports: [ReactiveFormsModule, SelectComponent],
  templateUrl: './persona-selector.component.html',
})
export class PersonaSelectorComponent {
  private readonly personaService = inject(PersonaService);
  private readonly featureFlagService = inject(FeatureFlagService);

  // Persona options available for selection
  protected readonly personaOptions = PERSONA_OPTIONS;
  // Feature flag for role selector
  protected readonly showRoleSelector = this.featureFlagService.getBooleanFlag('role-selector', false);
  // Show selector when feature flag is enabled
  protected readonly shouldShowSelector = this.showRoleSelector;

  public form: FormGroup;

  public constructor() {
    this.form = new FormGroup({
      persona: new FormControl<PersonaType>(this.personaService.currentPersona(), [Validators.required]),
    });

    this.form
      .get('persona')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value: PersonaType) => {
        this.personaService.setPersona(value);
      });
  }
}
