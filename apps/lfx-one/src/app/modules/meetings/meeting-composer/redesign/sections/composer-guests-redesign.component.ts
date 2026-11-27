// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, ElementRef, inject, Injector, type Signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { COMPOSER_GUEST_FILTER_THRESHOLD } from '@lfx-one/shared/constants';
import type { ComposerRedesignGuestRow } from '@lfx-one/shared/interfaces';
import { composerGuestSubline, isMeetingSelfGuestListed } from '@lfx-one/shared/utils';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { UiToggleComponent } from '@shared/uikit/toggle/toggle.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

import { ComposerGuestsComponent } from '../../sections/composer-guests.component';
import { ComposerGroupPickerComponent } from './composer-group-picker.component';

/**
 * Invite guests section of the redesigned composer: the same state and handlers as the drawer's guests section, in the new layout.
 * @description Same `form` input as `ComposerGuestsComponent`, so the composer shell can swap one for the other.
 */
@Component({
  selector: 'lfx-composer-guests-redesign',
  imports: [
    ComposerGroupPickerComponent,
    ConfirmDialogModule,
    ReactiveFormsModule,
    UiAvatarComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiNoteComponent,
    UiSearchInputComponent,
    UiToggleComponent,
    UiTooltipDirective,
    UserSearchComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './composer-guests-redesign.component.html',
})
export class ComposerGuestsRedesignComponent extends ComposerGuestsComponent {
  private readonly sectionHost: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly sectionInjector = inject(Injector);

  protected readonly rows: Signal<ComposerRedesignGuestRow[]> = this.initRows();
  protected readonly countLabel: Signal<string> = this.initCountLabel();
  protected readonly showFilter: Signal<boolean> = computed(() => this.guestCount() > COMPOSER_GUEST_FILTER_THRESHOLD || this.guestFilter() !== '');
  protected readonly showAttendeesControl: Signal<FormControl<boolean>> = computed(
    () => this.form().get(this.showMeetingAttendeesFeature.key) as FormControl<boolean>
  );

  public constructor() {
    super();
    // Keeps a directory pick's LFID on the row for its line; the create body still drops it.
    this.quickAddForm.addControl('username', new FormControl<string | null>(null));
  }

  protected onFilterChange(value: string): void {
    this.guestFilterForm.controls.query.setValue(value);
    if (!this.showFilter()) {
      // Clearing the filter hid the field that held focus, so the guest search takes it.
      afterNextRender(() => this.sectionHost.nativeElement.querySelector<HTMLElement>('#composer-guest-search')?.focus(), { injector: this.sectionInjector });
    }
  }

  private initRows(): Signal<ComposerRedesignGuestRow[]> {
    return computed(() => {
      const self = this.selfGuest();
      const occurrenceEdit = this.isOccurrenceEdit();

      return this.filteredGuestRows().map((row) => ({
        ...row,
        isSelf: !!self && isMeetingSelfGuestListed(self, [row.guest]),
        subline: composerGuestSubline(row.guest, occurrenceEdit),
        canResend: this.canResendInvite(row.guest),
        resending: this.inviteResend.isResending(row.guest.uid),
      }));
    });
  }

  private initCountLabel(): Signal<string> {
    return computed(() => {
      const count = this.guestCount();
      if (count === 0) {
        return 'Invited people';
      }
      return `${count} ${count === 1 ? 'person' : 'people'} invited`;
    });
  }
}
