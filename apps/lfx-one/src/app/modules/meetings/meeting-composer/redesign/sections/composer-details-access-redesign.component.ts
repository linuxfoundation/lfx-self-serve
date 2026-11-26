// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { MEETING_TITLE_MAX_LENGTH } from '@lfx-one/shared/constants';
import type { UserSearchResult } from '@lfx-one/shared/interfaces';
import { composeFullName, rankUserSearchResults } from '@lfx-one/shared/utils';
import { SearchService } from '@services/search.service';
import { controlValueSignal } from '@shared/utils/form-control-signals.util';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiChoiceboxGroupComponent } from '@shared/uikit/choicebox/choicebox-group.component';
import { UiChoiceboxComponent } from '@shared/uikit/choicebox/choicebox.component';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { debounceTime, finalize, map, Observable, of, switchMap, tap } from 'rxjs';

import { MeetingComposerFormService } from '../../meeting-composer-form.service';
import { ComposerDetailsAccessComponent } from '../../sections/composer-details-access.component';

/**
 * Details & Access section of the redesigned meeting composer.
 * @description Extends the drawer's section so inputs, validation signals, YouTube title rules and type options stay shared.
 * Adds its own organizer directory search (picked person shown as a removable chip) and maps the boolean join restriction
 * onto the string-valued choicebox group.
 */
@Component({
  selector: 'lfx-composer-details-access-redesign',
  imports: [
    NgClass,
    ReactiveFormsModule,
    UiAvatarComponent,
    UiButtonComponent,
    UiChoiceboxGroupComponent,
    UiChoiceboxComponent,
    UiComboboxComponent,
    UiInputComponent,
    UiOptionComponent,
    UiSelectComponent,
  ],
  templateUrl: './composer-details-access-redesign.component.html',
})
export class ComposerDetailsAccessRedesignComponent extends ComposerDetailsAccessComponent {
  private readonly searchService = inject(SearchService);
  private readonly composerForm = inject(MeetingComposerFormService);

  protected readonly isEditMode = this.composerForm.isEditMode;
  protected readonly organizerQuery = signal('');
  /** True while the organizer chip gives way to the search box without changing who is stored. */
  protected readonly organizerSearching = signal(false);
  protected readonly organizerLoading = signal(false);
  protected readonly organizerResults: Signal<UserSearchResult[]> = this.initOrganizerResults();

  protected readonly ownerName = controlValueSignal<string>(this.form, 'ownerName');
  protected readonly ownerEmail = controlValueSignal<string>(this.form, 'ownerEmail');
  protected readonly showOrganizerChip: Signal<boolean> = computed(() => !this.organizerSearching() && !!(this.ownerName() || this.ownerEmail()));
  protected readonly organizerHint: Signal<string> = computed(() =>
    this.isEditMode() ? 'Leave empty to keep the current organizer.' : 'Defaults to the meeting creator.'
  );

  /** The native cap: YouTube's limit while uploads are on, otherwise the composer's own 150. */
  protected readonly titleInputMaxlength: Signal<number> = computed(() => this.titleMaxlength() ?? MEETING_TITLE_MAX_LENGTH);
  protected readonly titleError: Signal<string> = this.initTitleError();
  protected readonly meetingTypeError: Signal<string> = computed(() => (this.meetingTypeRequiredError() ? 'Meeting type is required' : ''));
  protected readonly restrictedChoice: Signal<string | null> = computed(() => {
    const restricted = this.selectedRestricted();
    return restricted === null ? null : String(restricted);
  });

  protected fullName(user: UserSearchResult): string {
    return composeFullName(user.first_name, user.last_name) || user.email;
  }

  protected setRestricted(value: string | null): void {
    const control = this.form().get('restricted');
    control?.setValue(value === 'true');
    control?.markAsDirty();
  }

  protected pickOrganizer(uid: string | null): void {
    const user = this.organizerResults().find((result) => result.uid === uid);
    if (!user) {
      return;
    }

    const form = this.form();
    form.get('ownerEmail')?.setValue(user.email || null);
    form.get('ownerUsername')?.setValue(user.username || null);
    this.handleOwnerSelection(user);
    form.get('ownerName')?.markAsDirty();
    this.organizerQuery.set('');
    this.organizerSearching.set(false);
  }

  /** Create empties the organizer; edit restores the stored one and opens search, since upstream cannot remove an owner. */
  protected removeOrganizer(): void {
    this.clearOwnerSelection();
    if (this.savedOwner()) {
      this.organizerSearching.set(true);
    }
  }

  private initTitleError(): Signal<string> {
    return computed(() => {
      if (this.titleRequiredError()) {
        return 'Meeting title is required';
      }

      return this.titleMaxlengthError() ? `Meeting title cannot exceed ${this.youtubeTitleLimit} characters while YouTube uploads are enabled.` : '';
    });
  }

  private initOrganizerResults(): Signal<UserSearchResult[]> {
    return toSignal(
      toObservable(this.organizerQuery).pipe(
        tap((query) => this.organizerLoading.set(query.trim().length >= 2)),
        debounceTime(250),
        switchMap((query): Observable<UserSearchResult[]> => {
          const term = query.trim();
          if (term.length < 2) {
            this.organizerLoading.set(false);
            return of([]);
          }

          // SearchService already maps a failed request to an empty list.
          return this.searchService.searchUsers(term, 'committee_member').pipe(
            map((users) => rankUserSearchResults(users, term).slice(0, 6)),
            finalize(() => this.organizerLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
