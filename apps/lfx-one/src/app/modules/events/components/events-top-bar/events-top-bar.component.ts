// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, output, Signal, signal } from '@angular/core';
import { outputFromObservable, takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { FilterOption } from '@lfx-one/shared/interfaces';
import { debounceTime, map, switchMap, tap } from 'rxjs';
import { EventsService } from '@app/shared/services/events.service';
import { EVENT_ROLE_OPTIONS, MY_EVENT_STATUS_OPTIONS } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-events-top-bar',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent],
  templateUrl: './events-top-bar.component.html',
})
export class EventsTopBarComponent {
  private readonly eventsService = inject(EventsService);

  public isFoundationFilter = input<boolean>(false);
  public readonly projectName = input<string | undefined>(undefined);
  public readonly searchQueryChange = output<string>();

  public readonly searchForm: FormGroup = new FormGroup({
    search: new FormControl(''),
    foundation: new FormControl<string | null>(null),
    role: new FormControl<string | null>(null),
    status: new FormControl<string | null>(null),
  });

  public readonly foundationChange = outputFromObservable<string | null>(this.searchForm.get('foundation')!.valueChanges);
  public readonly roleChange = outputFromObservable<string | null>(this.searchForm.get('role')!.valueChanges);
  public readonly statusChange = outputFromObservable<string | null>(this.searchForm.get('status')!.valueChanges);

  protected readonly roleOptions = signal<FilterOption[]>(EVENT_ROLE_OPTIONS);

  protected readonly statusOptions = signal<FilterOption[]>(MY_EVENT_STATUS_OPTIONS);

  protected readonly foundationOptionsLoading = signal(true);
  protected readonly searchValue = signal('');
  protected readonly foundationOptions: Signal<FilterOption[]> = this.initFoundationOptions();

  public constructor() {
    const searchControl = this.searchForm.get('search');

    searchControl?.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      this.searchValue.set(value || '');
    });

    searchControl?.valueChanges.pipe(debounceTime(500), takeUntilDestroyed()).subscribe((value) => {
      this.searchQueryChange.emit(value || '');
    });
  }

  public clearSearch(): void {
    this.searchForm.get('search')?.setValue('');
  }

  private initFoundationOptions(): Signal<FilterOption[]> {
    return toSignal(
      toObservable(this.projectName).pipe(
        switchMap((projectName) =>
          this.eventsService.getEventOrganizations({ projectName }).pipe(
            tap(() => this.foundationOptionsLoading.set(false)),
            map(({ data }) => [{ label: 'All Foundations', value: null }, ...data.map((name) => ({ label: name, value: name }))])
          )
        )
      ),
      { initialValue: [{ label: 'All Foundations', value: null }] as FilterOption[] }
    );
  }
}
