// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { PERSONA_OPTIONS } from '@lfx-one/shared/constants';
import { PersonaType } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { SelectComponent } from '@shared/components/select/select.component';

@Component({
  selector: 'lfx-persona-selector',
  standalone: true,
  imports: [ReactiveFormsModule, SelectComponent],
  templateUrl: './persona-selector.component.html',
})
export class PersonaSelectorComponent {
  private readonly personaService = inject(PersonaService);
  private readonly projectContextService = inject(ProjectContextService);
  // Persona options available for selection
  protected readonly personaOptions = PERSONA_OPTIONS;

  public form: FormGroup;

  public constructor() {
    this.form = new FormGroup({
      persona: new FormControl<PersonaType>(this.personaService.currentPersona(), [Validators.required]),
    });

    this.form
      .get('persona')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value: PersonaType) => {
        if (value === 'board-member') {
          // TODO: DEMO - Remove when proper permissions are implemented
          this.projectContextService.setFoundation({
            uid: 'tlf',
            name: 'The Linux Foundation',
            slug: 'tlf',
          });
        }

        this.personaService.setPersona(value);
      });
  }
}
