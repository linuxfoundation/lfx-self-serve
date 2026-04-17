// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { EventsService } from '@app/shared/services/events.service';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { OrgSearchResult } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { catchError, debounceTime, map, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-org-search-field',
  imports: [ReactiveFormsModule, AutocompleteComponent],
  templateUrl: './org-search-field.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgSearchFieldComponent {
  private readonly eventsService = inject(EventsService);
  private readonly messageService = inject(MessageService);

  /** The parent FormGroup — must contain 'company' and 'organizationID' controls */
  public readonly form = input.required<FormGroup>();

  /** Separate form used only for the autocomplete binding — keeps the parent form controls clean */
  public readonly orgForm = new FormGroup({ company: new FormControl<OrgSearchResult | null>(null) });

  protected readonly orgSearchQuery = signal('');
  protected readonly orgSearchHasError = signal(false);
  protected readonly orgSuggestions: Signal<OrgSearchResult[]> = this.initOrgSuggestions();

  protected readonly isCompanyInvalid = computed(() => {
    const parentForm = this.form();
    return (
      parentForm.get('company')?.invalid && (parentForm.get('company')?.touched || this.orgForm.get('company')?.touched || this.orgForm.get('company')?.dirty)
    );
  });

  public onOrgSearch(event: AutoCompleteCompleteEvent): void {
    this.orgSearchQuery.set(event.query.trim());
  }

  public onOrgSelect(event: AutoCompleteSelectEvent): void {
    const org = event.value as OrgSearchResult;
    this.form().patchValue({ company: org.name, organizationID: org.id });
  }

  public onOrgClear(): void {
    this.form().patchValue({ company: '', organizationID: '' });
    this.orgSearchQuery.set('');
  }

  public onOrgBlur(): void {
    const orgValue = this.orgForm.get('company')?.value;
    if (!orgValue) {
      this.form().patchValue({ company: '', organizationID: '' });
      this.form().get('company')?.markAsTouched();
    }
  }

  private initOrgSuggestions(): Signal<OrgSearchResult[]> {
    return toSignal(
      toObservable(this.orgSearchQuery).pipe(
        debounceTime(400),
        switchMap((query) => {
          if (!query) {
            this.orgSearchHasError.set(false);
            return of([]);
          }
          return this.eventsService.searchOrganizations(query).pipe(
            map((response) => {
              this.orgSearchHasError.set(false);
              return response.data;
            }),
            catchError(() => {
              if (!this.orgSearchHasError()) {
                this.orgSearchHasError.set(true);
                this.messageService.add({
                  severity: 'error',
                  summary: 'Error',
                  detail: 'Failed to search organizations. Please try again.',
                });
              }
              return of([]);
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
