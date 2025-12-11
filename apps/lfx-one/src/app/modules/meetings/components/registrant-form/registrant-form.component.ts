// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { OrganizationSearchComponent } from '@components/organization-search/organization-search.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { MeetingRegistrant } from '@lfx-one/shared/interfaces';
import { filter, take } from 'rxjs';

@Component({
  selector: 'lfx-registrant-form',
  imports: [ReactiveFormsModule, InputTextComponent, CheckboxComponent, OrganizationSearchComponent, UserSearchComponent],
  templateUrl: './registrant-form.component.html',
})
export class RegistrantFormComponent {
  // Inputs
  public form = input.required<FormGroup>();
  public registrant = input<MeetingRegistrant | null>(null);

  // State to track whether we're showing search or individual fields
  public showIndividualFields = signal(false);

  public constructor() {
    // If we have an existing registrant, show individual fields immediately
    // Using toObservable to specifically track only registrant changes
    toObservable(this.registrant)
      .pipe(
        filter((registrant) => registrant !== null),
        take(1)
      )
      .subscribe(() => {
        this.showIndividualFields.set(true);
      });
  }

  /**
   * Handle user selection from search component
   * The form controls are already populated by the search component
   */
  public handleUserSelection(): void {
    // The search component has already populated the form controls
    // Now show the individual input fields
    this.showIndividualFields.set(true);
    this.form().markAsDirty();
  }

  /**
   * Switch to manual entry mode when user clicks "Enter details manually"
   */
  public switchToManualEntry(): void {
    // Clear the form for manual entry
    const hostValue = this.form().get('host')?.value; // Preserve host checkbox state
    this.form().reset();
    this.form().get('host')?.setValue(hostValue);

    // Show individual fields for manual entry
    this.showIndividualFields.set(true);
  }

  /**
   * Go back to search mode
   */
  public backToSearch(): void {
    // Reset form but preserve host checkbox
    const hostValue = this.form().get('host')?.value;
    this.form().reset();
    this.form().get('host')?.setValue(hostValue);

    // Switch back to search mode
    this.showIndividualFields.set(false);
  }
}
