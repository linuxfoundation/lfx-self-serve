// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { PERSONA_OPTIONS } from '@lfx-one/shared/constants';
import { PersonaType } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@services/persona.service';
import { SelectComponent } from '@shared/components/select/select.component';

@Component({
  selector: 'lfx-persona-selector',
  standalone: true,
  imports: [ReactiveFormsModule, SelectComponent],
  templateUrl: './persona-selector.component.html',
})
export class PersonaSelectorComponent {
  private readonly personaService = inject(PersonaService);

  // Persona options available for selection
  protected readonly personaOptions = PERSONA_OPTIONS;

  public form: FormGroup;

  public constructor() {
    this.form = new FormGroup({
      persona: new FormControl<PersonaType>('core-developer', [Validators.required]),
    });

    effect(() => {
      if (this.form.get('persona')?.value !== this.personaService.currentPersona()) {
        this.form.get('persona')?.setValue(this.personaService.currentPersona());
      }
    });

    this.form
      .get('persona')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value: PersonaType) => {
        this.personaService.setPersona(value);
      });
  }
}
