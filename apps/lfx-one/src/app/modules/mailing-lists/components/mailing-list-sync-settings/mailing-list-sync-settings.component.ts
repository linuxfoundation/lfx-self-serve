// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, inject, input, output, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SettingsCardComponent } from '@components/settings-card/settings-card.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { COMMITTEE_LABEL, MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { MailingListSyncMode } from '@lfx-one/shared/enums';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MailingListService } from '@services/mailing-list.service';
import { MessageService } from 'primeng/api';
import { catchError, of, switchMap } from 'rxjs';

/**
 * Sync Settings section for the mailing list view page (#4024) — the ON/OFF toggle and direction
 * selector that control `sync_mode` on the mailing list's linked committee. Mirrors PCC's Manage
 * Members page "Sync Settings" section. Only one mailing list per committee may have automatic sync
 * configured at a time (enforced here in the UI by disabling the selector, and ultimately by ITX),
 * so `activeSync` resolves whichever *other* linked mailing list already has a direction set.
 */
@Component({
  selector: 'lfx-mailing-list-sync-settings',
  imports: [ReactiveFormsModule, SettingsCardComponent, ToggleComponent, SelectButtonComponent, ButtonComponent],
  templateUrl: './mailing-list-sync-settings.component.html',
})
export class MailingListSyncSettingsComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);

  public readonly mailingList = input.required<GroupsIOMailingList>();
  public readonly updated = output<GroupsIOMailingList>();

  protected readonly committeeLabel = COMMITTEE_LABEL;
  protected readonly MailingListSyncMode = MailingListSyncMode;

  protected readonly directionOptions = [
    { label: 'Committee → Mailing List', value: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST },
    { label: 'Mailing List → Committee', value: MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE },
  ];

  // Dark-launch gate for this whole section (#4024). UI-only — see constant doc comment for the
  // real-time auto-sync execution kill switch tracked separately in #4878.
  protected readonly syncEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG, false);

  protected readonly saving = signal(false);

  public readonly form = new FormGroup({
    direction: new FormControl<MailingListSyncMode>(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST, { nonNullable: true }),
  });

  protected readonly committee = computed(() => this.mailingList().committees?.[0] ?? null);
  protected readonly syncOn = computed(() => !!this.mailingList().sync_mode && this.mailingList().sync_mode !== MailingListSyncMode.MANUAL);

  // Other mailing lists linked to the same committee, used to resolve whether a sync direction is
  // already active elsewhere (only one direction is allowed per committee at a time).
  private readonly siblingLists: Signal<GroupsIOMailingList[]> = this.initSiblingLists();
  protected readonly activeSync: Signal<GroupsIOMailingList | null> = this.initActiveSync();

  public constructor() {
    // Keep the selector's displayed value in sync with the persisted sync_mode (e.g. on initial
    // load, or after a refresh brings in a value set from elsewhere), without re-triggering a save.
    effect(() => {
      const syncMode = this.mailingList().sync_mode;
      if (syncMode && syncMode !== MailingListSyncMode.MANUAL) {
        this.form.controls.direction.setValue(syncMode, { emitEvent: false });
      }
    });
    this.form.controls.direction.valueChanges.subscribe((direction) => this.save(direction));

    // Only one direction is allowed per committee at a time — lock the selector whenever another
    // linked mailing list already has one configured.
    effect(() => {
      if (this.activeSync()) {
        this.form.controls.direction.disable({ emitEvent: false });
      } else {
        this.form.controls.direction.enable({ emitEvent: false });
      }
    });
  }

  protected onToggleChange(checked: boolean): void {
    if (!checked) {
      this.save(MailingListSyncMode.MANUAL);
      return;
    }
    const active = this.activeSync();
    const direction = active?.sync_mode ?? this.form.controls.direction.value;
    this.form.controls.direction.setValue(direction, { emitEvent: false });
    this.save(direction);
  }

  protected onSyncNow(): void {
    // Preview/apply flow is Feature 6 (#4027) — this is a stub entry point per #4024's scope.
    this.messageService.add({
      severity: 'info',
      summary: 'Coming soon',
      detail: 'Sync preview is not available yet.',
    });
  }

  private save(syncMode: MailingListSyncMode): void {
    const ml = this.mailingList();
    this.saving.set(true);
    this.mailingListService
      .updateMailingList(ml.uid, { sync_mode: syncMode })
      .pipe(
        catchError(() => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update sync settings' });
          return of(null);
        })
      )
      .subscribe((result) => {
        this.saving.set(false);
        if (result) {
          this.updated.emit(result);
        }
      });
  }

  private initSiblingLists(): Signal<GroupsIOMailingList[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        switchMap((committee) => (committee ? this.mailingListService.getMailingListsByCommittee(committee.uid) : of([]))),
        catchError(() => of([] as GroupsIOMailingList[]))
      ),
      { initialValue: [] as GroupsIOMailingList[] }
    );
  }

  private initActiveSync(): Signal<GroupsIOMailingList | null> {
    return computed(() => {
      const selfUid = this.mailingList().uid;
      return this.siblingLists().find((ml) => ml.uid !== selfUid && !!ml.sync_mode && ml.sync_mode !== MailingListSyncMode.MANUAL) ?? null;
    });
  }
}
