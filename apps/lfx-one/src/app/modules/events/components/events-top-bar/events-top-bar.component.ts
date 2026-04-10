// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, output, Signal, signal } from '@angular/core';
import { outputFromObservable, takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { FilterOption } from '@lfx-one/shared/interfaces';
import { combineLatest, debounceTime, distinctUntilChanged, finalize, map, of, shareReplay, skip, switchMap } from 'rxjs';
import { EventsService } from '@app/shared/services/events.service';
import { EVENT_ROLE_OPTIONS, MY_EVENT_STATUS_OPTIONS } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-events-top-bar',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent],
  templateUrl: './events-top-bar.component.html',
})
export class EventsTopBarComponent {
  private readonly eventsService = inject(EventsService);

  public readonly isFoundationFilter = input<boolean>(false);
  public readonly showRoleFilter = input<boolean>(true);
  public readonly projectName = input<string | undefined>(undefined);
  /** When true, foundation options are scoped to the user's registered past events */
  public readonly isPast = input<boolean>(false);
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

  public readonly statusOptions = input<FilterOption[]>(MY_EVENT_STATUS_OPTIONS);

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

    // Clear the foundation dropdown when the tab changes (isPast flips).
    // emitEvent: false prevents a spurious foundationChange output that would conflict
    // with the dashboard's own selectedFoundation reset.
    toObservable(this.isPast)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.searchForm.get('foundation')?.setValue(null, { emitEvent: false });
      });
  }

  public clearSearch(): void {
    this.searchForm.get('search')?.setValue('');
  }

  private initFoundationOptions(): Signal<FilterOption[]> {
    const defaultOptions = [{ label: 'All Foundations', value: null }] as FilterOption[];
    return toSignal(
      combineLatest([toObservable(this.projectName), toObservable(this.isPast), toObservable(this.isFoundationFilter)]).pipe(
        distinctUntilChanged((a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]),
        switchMap(([projectName, isPast, isFoundationFilter]) => {
          if (!isFoundationFilter) {
            // Foundation dropdown is not rendered — skip the API call and clear loading.
            this.foundationOptionsLoading.set(false);
            return of(defaultOptions);
          }
          this.foundationOptionsLoading.set(true);
          return this.eventsService.getEventOrganizations({ projectName, isPast }).pipe(
            map(({ data }) => [{ label: 'All Foundations', value: null }, ...data.map((name) => ({ label: name, value: name }))]),
            finalize(() => this.foundationOptionsLoading.set(false))
          );
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      ),
      { initialValue: defaultOptions }
    );
  }
}
