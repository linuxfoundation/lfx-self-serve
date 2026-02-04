// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SKILL_TAXONOMY } from '@lfx-one/shared/constants';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { startWith } from 'rxjs';

/**
 * ManageSkillsComponent is a dialog for managing user skills.
 * Features:
 * - Search/autocomplete from skill taxonomy
 * - Add/remove skills
 * - Alphabetically sorted display
 */
@Component({
  selector: 'lfx-manage-skills',
  imports: [ReactiveFormsModule, InputTextComponent, ButtonComponent],
  templateUrl: './manage-skills.component.html',
  styleUrl: './manage-skills.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageSkillsComponent {
  // Private injections
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly fb = inject(NonNullableFormBuilder);

  // Form for search input
  public readonly searchForm = this.fb.group({
    search: [''],
  });

  // Simple WritableSignals
  public selectedSkills = signal<string[]>([]);

  // Computed signal from form value
  public readonly skillSearch: Signal<string> = this.initSkillSearch();

  // Computed signals
  public readonly filteredTaxonomy = computed(() => {
    const search = this.skillSearch().toLowerCase().trim();
    if (!search) return [];
    return SKILL_TAXONOMY.filter((s) => s.toLowerCase().includes(search) && !this.selectedSkills().includes(s)).slice(0, 10);
  });

  public readonly sortedSelectedSkills = computed(() => [...this.selectedSkills()].sort((a, b) => a.localeCompare(b)));

  public constructor() {
    // Init from dialog config data
    const initialSkills = (this.dialogConfig.data?.skills as string[]) ?? [];
    this.selectedSkills.set([...initialSkills]);
  }

  // Public methods
  public addSkill(skill: string): void {
    if (!this.selectedSkills().includes(skill)) {
      this.selectedSkills.update((current) => [...current, skill]);
      this.searchForm.patchValue({ search: '' });
    }
  }

  public removeSkill(skill: string): void {
    this.selectedSkills.update((current) => current.filter((s) => s !== skill));
  }

  public cancel(): void {
    this.dialogRef.close(null);
  }

  public save(): void {
    this.dialogRef.close(this.selectedSkills());
  }

  // Private init functions
  private initSkillSearch(): Signal<string> {
    return toSignal(this.searchForm.controls.search.valueChanges.pipe(startWith(this.searchForm.controls.search.value)), { initialValue: '' });
  }
}
