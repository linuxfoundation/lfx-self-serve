// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SettingsCardComponent } from '@components/settings-card/settings-card.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { COMMITTEE_LABEL, MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { MailingListSyncMode } from '@lfx-one/shared/enums';
import { CreateMailingListRequest, GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MailingListService } from '@services/mailing-list.service';
import { MessageService } from 'primeng/api';
import { catchError, distinctUntilChanged, of, switchMap, take } from 'rxjs';

/**
 * Sync Settings section for the mailing list view page (#4024) — the ON/OFF toggle and direction
 * selector that control `sync_mode` on the mailing list's linked committee. Mirrors PCC's Manage
 * Members page "Sync Settings" section. Only one mailing list per committee may have automatic sync
 * configured at a time (enforced here in the UI by disabling the toggle/selector, and ultimately by
 * ITX), so `activeSync` resolves whichever *other* linked mailing list already has a direction set.
 */
@Component({
  selector: 'lfx-mailing-list-sync-settings',
  imports: [ReactiveFormsModule, SettingsCardComponent, ToggleComponent, SelectButtonComponent, ButtonComponent, LowerCasePipe],
  templateUrl: './mailing-list-sync-settings.component.html',
})
export class MailingListSyncSettingsComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  public readonly mailingList = input.required<GroupsIOMailingList>();
  public readonly updated = output<GroupsIOMailingList>();

  protected readonly committeeLabel = COMMITTEE_LABEL;
  protected readonly MailingListSyncMode = MailingListSyncMode;

  protected readonly directionOptions = [
    { label: `${COMMITTEE_LABEL.singular} → Mailing List`, value: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST },
    { label: `Mailing List → ${COMMITTEE_LABEL.singular}`, value: MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE },
  ];

  public readonly form = new FormGroup({
    direction: new FormControl<MailingListSyncMode>(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST, { nonNullable: true }),
  });

  // Dark-launch gate for this whole section (#4024). UI-only — see constant doc comment for the
  // real-time auto-sync execution kill switch tracked separately in #4878.
  protected readonly syncEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG, false);

  // The `:id` view route (mailing-lists.routes.ts) is authGuard-only, unlike `create`/`:id/edit`
  // (writerGuard too), so any authenticated viewer can reach this page — gate the write-capable
  // section ourselves using the same `writer` flag the service already returns per-resource.
  protected readonly isWriter = computed(() => this.mailingList().writer === true);

  protected readonly saving = signal(false);
  // Writable rather than a computed off mailingList() — the toggle needs to reflect an optimistic
  // click immediately and then be explicitly reverted on a failed save. A computed re-evaluates to
  // the *same* value it had before the click (mailingList() never changes on failure), so Angular's
  // [ngModel] binding on lfx-toggle's underlying p-toggleSwitch sees no input change and never calls
  // writeValue — the switch visually sticks in the clicked position (#4880 review).
  protected readonly syncOn = signal(false);

  protected readonly committee = computed(() => this.mailingList().committees?.[0] ?? null);

  // Set when the sibling lookup errors — `activeSync()` can't be trusted in this state (we don't know
  // whether another list already has a direction configured), so the template disables sync controls
  // rather than silently risking a second auto-sync direction on the same committee (#4880 review).
  protected readonly siblingLookupFailed = signal(false);
  // Bumped by retrySiblingLookup() to force a re-fetch of the same committee uid (#4880 review).
  private readonly siblingLookupRetryNonce = signal(0);

  // Other mailing lists linked to the same committee, used to resolve whether a sync direction is
  // already active elsewhere (only one direction is allowed per committee at a time).
  private readonly siblingLists: Signal<GroupsIOMailingList[]> = this.initSiblingLists();
  protected readonly activeSync: Signal<GroupsIOMailingList | null> = this.initActiveSync();

  public constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));

    // Keep the selector's displayed value in sync with the persisted sync_mode (e.g. on initial
    // load, or after a refresh brings in a value set from elsewhere), without re-triggering a save.
    // Guarded on an actual value change so a re-emission of `mailingList()` with the same sync_mode
    // (e.g. after `refreshData()`) can't clobber a direction the user just picked locally.
    effect(() => {
      const syncMode = this.mailingList().sync_mode;
      if (syncMode && syncMode !== MailingListSyncMode.MANUAL && this.form.controls.direction.value !== syncMode) {
        this.form.controls.direction.setValue(syncMode, { emitEvent: false });
      }
    });
    this.form.controls.direction.valueChanges.pipe(takeUntilDestroyed()).subscribe((direction) => this.save(direction));

    // Keep the toggle in sync with the persisted sync_mode whenever mailingList() actually changes
    // (initial load, a successful save's updated() round-trip, or a refresh from elsewhere) — mirrors
    // the direction-selector effect above. onToggleChange()/the catchError handler below set this
    // signal directly for the optimistic-click and revert-on-failure cases, which don't change
    // mailingList() at all.
    effect(() => {
      const syncMode = this.mailingList().sync_mode;
      this.syncOn.set(!!syncMode && syncMode !== MailingListSyncMode.MANUAL);
    });

    // Only one direction is allowed per committee at a time — lock the selector whenever another
    // linked mailing list already has one configured, while a save is in flight (so a second
    // direction change can't fire an overlapping PUT that races the first), or whenever the sibling
    // lookup itself failed (we can't verify the "only one direction" invariant without it, so err
    // toward blocking writes rather than risking a second auto-sync direction, #4880 review).
    effect(() => {
      if (this.saving() || this.activeSync() || this.siblingLookupFailed()) {
        this.form.controls.direction.disable({ emitEvent: false });
      } else {
        this.form.controls.direction.enable({ emitEvent: false });
      }
    });
  }

  protected retrySiblingLookup(): void {
    // Bumps the lookup's nonce so the lookup observable re-runs even though the committee uid itself
    // hasn't changed — a bare `distinctUntilChanged()` on the uid alone would otherwise suppress this
    // retry as a duplicate emission (#4880 review).
    this.siblingLookupRetryNonce.update((n) => n + 1);
  }

  protected onToggleChange(checked: boolean): void {
    // Optimistic — reverted explicitly in save()'s catchError if the write fails (#4880 review).
    this.syncOn.set(checked);
    if (!checked) {
      this.save(MailingListSyncMode.MANUAL);
      return;
    }
    // The toggle is disabled whenever activeSync() is set, so checked=true only ever fires when
    // activeSync() is null — always fall back to the selector's current value (#4880 review).
    this.save(this.form.controls.direction.value);
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
      .updateMailingList(ml.uid, this.buildUpdatePayload(ml, syncMode))
      .pipe(
        catchError((error) => {
          console.error('Failed to update mailing list sync settings', error);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update sync settings' });
          // Restore the selector to the persisted direction — the form control already picked up
          // the attempted value via valueChanges, but the server never accepted it (#4880 review).
          const persisted = ml.sync_mode && ml.sync_mode !== MailingListSyncMode.MANUAL ? ml.sync_mode : MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST;
          this.form.controls.direction.setValue(persisted, { emitEvent: false });
          // Revert the toggle to the last-persisted state — the optimistic set() in onToggleChange
          // already changed it, so this is guaranteed to be an actual signal change even when
          // reverting to the mailing list's pre-click value (#4880 review).
          this.syncOn.set(!!ml.sync_mode && ml.sync_mode !== MailingListSyncMode.MANUAL);
          return of(null);
        }),
        // Mailing-list writes are fire-and-forget in this codebase (take(1), not
        // takeUntilDestroyed) — leaving the page mid-save must not cancel the PUT (#4880 review).
        take(1)
      )
      .subscribe((result) => {
        this.saving.set(false);
        // The save is deliberately fire-and-forget (take(1), not takeUntilDestroyed — see above), so
        // this callback can still run after the component is destroyed (e.g. user navigated away
        // mid-save). `output()` already no-ops a post-destroy emit, but guard explicitly so we don't
        // rely on that incidental behavior (#4880 review).
        if (result && !this.destroyed) {
          this.updated.emit(result);
        }
      });
  }

  // `PUT /api/mailing-lists/:id` replaces the full resource (see buildMlUpdatePayload in
  // committee-settings-tab.component.ts and prepareMailingListData in
  // mailing-list-manage.component.ts, both of which already send every field for this reason) —
  // sending only `{ sync_mode }` drops `committee_uid`/`service_id`, which upstream rejects
  // (`sync_mode requires committee_uid`) whenever a committee is linked.
  private buildUpdatePayload(ml: GroupsIOMailingList, syncMode: MailingListSyncMode): Partial<CreateMailingListRequest> {
    return {
      name: ml.group_name,
      public: ml.public,
      type: ml.type,
      audience_access: ml.audience_access,
      description: ml.description,
      title: ml.title,
      service_id: ml.service_uid,
      committee_uid: this.committee()?.uid ?? null,
      subject_tag: ml.subject_tag,
      writers: ml.writers,
      auditors: ml.auditors,
      sync_mode: syncMode,
    };
  }

  private initSiblingLists(): Signal<GroupsIOMailingList[]> {
    // Gate on the feature flag and writer status so this section's hidden state (enforced in the
    // template) doesn't still add a request to every committee-linked list view (#4880 review) —
    // folded into the observed signal itself, not just read inside switchMap, so the lookup also
    // (re-)runs if the flag/writer status becomes true after the committee uid last changed, e.g.
    // on a direct page load where FeatureFlagService.initialize() hasn't resolved yet (#4880 review).
    const lookupKey = computed(() => ({
      committeeUid: this.syncEnabled() && this.isWriter() ? (this.committee()?.uid ?? null) : null,
      nonce: this.siblingLookupRetryNonce(),
    }));
    return toSignal(
      toObservable(lookupKey).pipe(
        distinctUntilChanged((a, b) => a.committeeUid === b.committeeUid && a.nonce === b.nonce),
        switchMap(({ committeeUid }) => {
          this.siblingLookupFailed.set(false);
          if (!committeeUid) {
            return of([] as GroupsIOMailingList[]);
          }
          return this.mailingListService.getMailingListsByCommittee(committeeUid).pipe(
            catchError((error) => {
              console.error('Failed to load sibling mailing lists for sync settings', error);
              this.siblingLookupFailed.set(true);
              return of([] as GroupsIOMailingList[]);
            })
          );
        })
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
