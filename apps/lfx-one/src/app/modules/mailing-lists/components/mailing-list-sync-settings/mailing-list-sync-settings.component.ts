// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, output, signal, Signal, untracked } from '@angular/core';
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
import { catchError, finalize, map, of, switchMap, take } from 'rxjs';

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
  // When the caller already has every mailing list linked to the committee in hand (the Auto Sync
  // drawer, which renders one instance per list — #4025 review), pass it here so each instance
  // reuses that data instead of issuing its own getMailingListsByCommittee request. Left undefined
  // on the standalone mailing-list view page (#4024), where no such list exists to share.
  public readonly siblingCandidates = input<GroupsIOMailingList[] | undefined>(undefined);
  // The committee this instance is scoped to. A mailing list can be linked to more than one
  // committee, so `mailingList().committees` can hold several entries — without this, `committee()`
  // always picked `committees[0]`, which shows the wrong committee's name and writes sync_mode to
  // the wrong committee whenever the caller (the Auto Sync drawer, one instance per committee) is
  // showing a list linked to more than one (#4899 review). Left undefined on the standalone
  // mailing-list view page (#4024), which has no "current committee" of its own to pass — falls back
  // to `committees[0]` there.
  public readonly committeeUid = input<string | undefined>(undefined);
  // Set by the Auto Sync drawer while a *different* card is mid-save (#4899 review). Two cards can
  // each read the same associatedMailingLists() snapshot and both pass their own "no active sync
  // elsewhere" check before either save's round-trip lands and refreshes that snapshot — this locks
  // the other cards' controls for the duration so only the saving card's own PUT can be in flight.
  public readonly lockedBySibling = input(false);
  public readonly updated = output<GroupsIOMailingList>();
  // Lets a host that can destroy this component mid-save (the Auto Sync drawer, which tears down
  // every open instance's `(updated)` binding on close) know a save is in flight, so it can block
  // closing until it settles instead of silently dropping the result (#4899 review).
  public readonly savingChange = output<boolean>();

  protected readonly committeeLabel = COMMITTEE_LABEL;
  protected readonly MailingListSyncMode = MailingListSyncMode;

  protected readonly directionOptions = [
    { label: `${COMMITTEE_LABEL.singular} → Mailing List`, value: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST },
    { label: `Mailing List → ${COMMITTEE_LABEL.singular}`, value: MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE },
  ];

  // Construction-safe default — NOT this.initDirection(): a required input can't be read during
  // field initialization (part of the constructor), only once Angular has bound it, so doing so
  // threw NG0950 and broke both the Auto Sync drawer and the mailing-list page (#5578 review). The
  // constructor effect below reads `mailingList()` once inputs are available and corrects this to
  // the persisted direction before the initial render.
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
  // Tracks which mailing list uid the in-flight save belongs to, separately from `saving` itself —
  // this component can be reused across a route navigation from one mailing list's page to another
  // (the standalone view page binds `mailingList` directly to a router input, unlike the drawer's
  // @for-keyed instances), and a save is fire-and-forget (take(1), not takeUntilDestroyed), so it
  // can still be in flight when `mailingList()` switches to a different list. Without this, the
  // mailingList()-driven effect below would read a stale `saving === true` left over from the
  // previous list and skip syncing the toggle to the new list's persisted state (#4899 review).
  private readonly savingUid = signal<string | null>(null);

  protected readonly committee = computed(() => {
    const committees = this.mailingList().committees;
    const scopedUid = this.committeeUid();
    if (scopedUid) {
      return committees?.find((c) => c.uid === scopedUid) ?? null;
    }
    return committees?.[0] ?? null;
  });

  // Writable, not a computed off mailingList().sync_mode: a failed save leaves mailingList()
  // unchanged, so a computed would re-evaluate to the exact value it had before the click and
  // lfx-toggle's [ngModel] binding would see no input change — the switch would stay stuck in the
  // clicked position instead of snapping back (#4899 review / #4880 review). Set optimistically in
  // onToggleChange() and explicitly reverted in save()'s catchError.
  // Construction-safe default — NOT this.initSyncOn(): a required input can't be read during field
  // initialization (part of the constructor), only once Angular has bound it, so doing so threw
  // NG0950 and broke both the Auto Sync drawer and the mailing-list page (#5578 review). The
  // constructor effect below reads `mailingList()` once inputs are available and corrects this to
  // the persisted state before the initial render.
  protected readonly syncOn = signal(false);

  // Set when the sibling lookup errors — `activeSync()` can't be trusted in this state (we don't know
  // whether another list already has a direction configured), so the template disables sync controls
  // rather than silently risking a second auto-sync direction on the same committee (#4880 review).
  protected readonly siblingLookupFailed = signal(false);
  // Set for the duration of the lookup — `activeSync()` can't be trusted as "no sibling has sync"
  // while the request is still in flight (its initial `[]` value looks identical to a resolved,
  // empty result), so controls must stay disabled until this clears too (#4880 review).
  protected readonly siblingLookupLoading = signal(false);
  // Bumped by retrySiblingLookup() to force a re-fetch of the same committee uid (#4880 review).
  private readonly siblingLookupRetryNonce = signal(0);

  // Other mailing lists linked to the same committee, used to resolve whether a sync direction is
  // already active elsewhere (only one direction is allowed per committee at a time).
  private readonly siblingLists: Signal<GroupsIOMailingList[]> = this.initSiblingLists();
  protected readonly activeSync: Signal<GroupsIOMailingList | null> = this.initActiveSync();

  public constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));

    // toObservable + takeUntilDestroyed, not effect() — savingChange.emit() is a side effect on a
    // parent, not a write to a signal this component owns, which is what effect() is meant for
    // (#4899 review nitpick).
    toObservable(this.saving)
      .pipe(takeUntilDestroyed())
      .subscribe((saving) => this.savingChange.emit(saving));

    // Keep the toggle's displayed value in sync with the persisted sync_mode on initial load and on
    // any refresh that brings in a value set from elsewhere (e.g. another drawer instance's save
    // flowing back through the parent's refetch) — a save in flight only ever changes `syncOn`
    // through onToggleChange()/save() below, never through this input-driven effect.
    effect(() => {
      const ml = this.mailingList();
      // Read `saving`/`savingUid` untracked so this effect depends only on `mailingList()` — a
      // tracked read also re-runs this effect the instant a successful save flips `saving` back to
      // false, which still observes the pre-save `mailingList()` input (the parent's refresh hasn't
      // landed yet) and would snap the toggle back to the old value until that refresh arrives
      // (#4899 review). Gated on `savingUid` matching the *current* list, not a bare `saving`
      // boolean — otherwise a save still in flight for a previously-displayed list (this component
      // can be reused across navigation) would suppress syncing the toggle to the newly-displayed
      // list's actual persisted state (#4899 review).
      if (untracked(this.saving) && untracked(this.savingUid) === ml.uid) return;
      this.syncOn.set(!!ml.sync_mode && ml.sync_mode !== MailingListSyncMode.MANUAL);
    });

    // Keep the selector's displayed value in sync with the persisted sync_mode (e.g. on initial
    // load, or after a refresh brings in a value set from elsewhere), without re-triggering a save.
    // Guarded on an actual value change so a re-emission of `mailingList()` with the same sync_mode
    // (e.g. after `refreshData()`) can't clobber a direction the user just picked locally.
    effect(() => {
      const ml = this.mailingList();
      // Same reuse-across-navigation guard as the syncOn effect above: a save still in flight for a
      // previously-displayed list must not block syncing the selector to the newly-displayed list's
      // actual persisted state (#4899 review).
      if (untracked(this.saving) && untracked(this.savingUid) === ml.uid) return;
      const syncMode = ml.sync_mode;
      // Falls back to the default direction, not just "leave the selector alone", when the
      // newly-displayed list has no active auto sync (MANUAL or unset) — otherwise navigating from a
      // list with one direction configured to a list with none left the selector showing the
      // previous list's direction (#4899 review).
      const nextDirection = syncMode && syncMode !== MailingListSyncMode.MANUAL ? syncMode : MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST;
      if (this.form.controls.direction.value !== nextDirection) {
        this.form.controls.direction.setValue(nextDirection, { emitEvent: false });
      }
    });
    this.form.controls.direction.valueChanges.pipe(takeUntilDestroyed()).subscribe((direction) => this.save(direction));

    // Only one direction is allowed per committee at a time — lock the selector whenever another
    // linked mailing list already has one configured, while a save is in flight (so a second
    // direction change can't fire an overlapping PUT that races the first), whenever the sibling
    // lookup itself failed (we can't verify the "only one direction" invariant without it, so err
    // toward blocking writes rather than risking a second auto-sync direction, #4880 review), or
    // whenever a sibling card elsewhere in the same drawer is mid-save (#4899 review).
    effect(() => {
      if (this.saving() || this.activeSync() || this.lockedBySibling() || this.siblingLookupFailed() || this.siblingLookupLoading()) {
        this.form.controls.direction.disable({ emitEvent: false });
      } else {
        this.form.controls.direction.enable({ emitEvent: false });
      }
    });
  }

  protected retrySiblingLookup(): void {
    // Bumps the lookup's nonce so the lookup observable re-runs even though the committee uid itself
    // hasn't changed (#4880 review).
    this.siblingLookupRetryNonce.update((n) => n + 1);
  }

  protected onToggleChange(checked: boolean): void {
    // Set immediately, before the save resolves, so the switch reflects the click right away
    // instead of waiting on the round-trip — reverted in save()'s catchError on failure (#4899/#4880 review).
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
    this.savingUid.set(ml.uid);
    this.mailingListService
      .updateMailingList(ml.uid, this.buildUpdatePayload(ml, syncMode))
      .pipe(
        catchError((error) => {
          console.error('Failed to update mailing list sync settings', error);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update sync settings' });
          // Restore the toggle and selector to the persisted state — both already picked up the
          // attempted value optimistically (onToggleChange / valueChanges), but the server never
          // accepted it (#4880 review, #4899 review). Gated on the component still displaying the
          // same list this save was for — this component can be reused across navigation, and a
          // rollback for a now-hidden list must not clobber the newly-displayed list's own state
          // with `ml`'s stale persisted mode (#4899 review).
          if (this.mailingList().uid === ml.uid) {
            this.syncOn.set(!!ml.sync_mode && ml.sync_mode !== MailingListSyncMode.MANUAL);
            const persisted = ml.sync_mode && ml.sync_mode !== MailingListSyncMode.MANUAL ? ml.sync_mode : MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST;
            this.form.controls.direction.setValue(persisted, { emitEvent: false });
          }
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
          // `updateMailingList` returns the BFF's raw indexed PUT response, which lacks GET-only
          // enrichment (`writer`, committee names, project/service details) and hasn't caught up to
          // the just-submitted `sync_mode` in the index yet. Emit the pre-save enriched input with
          // only `sync_mode` overridden — spreading `...result` on top of `ml` let any
          // overlapping-but-less-enriched field in the raw doc (e.g. `committees` as uid-only
          // entries, blank `project_name`/`project_slug`) win over the enriched copy, silently
          // downgrading the parent's data even though the save only changed `sync_mode` (#4880
          // review / lfx-one review / #4899 review).
          this.updated.emit({ ...ml, sync_mode: syncMode });
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
    // Every reactive dependency folded into one computed, not read inside the switchMap callback —
    // a signal read inside an RxJS operator body is untracked, so a later change to it would not
    // trigger a refetch (#4899 review; this previously regressed a fix from 323dbfa78 the same way).
    // Drawer instances reuse `siblingCandidates`; the switchMap re-runs whenever the parent passes a
    // new array (every save via associatedMlOverrides, every refresh). Standalone instances fetch
    // once per committeeUid+nonce+mailingListUid; retrySiblingLookup() bumps the nonce to force a refetch.
    const lookupKey = computed(() => {
      // mailingListUid both establishes this computed's dependency on `mailingList` (needed so a save
      // that replaces the parent's `associatedMailingLists()` entry, and thus this input, re-runs the
      // switchMap) and is folded into the standalone-fetch cache key below, so navigating to a
      // sibling list under the same committee/nonce revalidates instead of returning the previously
      // displayed list's stale cached result (#4899 review).
      return {
        candidates: this.siblingCandidates(),
        committeeUid: this.syncEnabled() && this.isWriter() ? (this.committee()?.uid ?? null) : null,
        nonce: this.siblingLookupRetryNonce(),
        mailingListUid: this.mailingList().uid,
      };
    });

    // Standalone-page (no `candidates`) network fetches only, keyed by committeeUid+nonce+mailingListUid
    // — lets a save's new `mailingList` object identity re-run the switchMap (needed for the drawer's
    // candidates path above) without re-triggering a real refetch, and the loading lock that comes
    // with it, when neither the committee nor an explicit retry actually changed. The displayed
    // list's own uid is in the key so navigating to a sibling list under the same committee/nonce
    // (e.g. right after turning sync off on the first list) revalidates instead of returning that
    // first list's cached result (#4899 review).
    let lastFetchKey: string | null = null;
    let lastFetchResult: GroupsIOMailingList[] = [];

    return toSignal(
      toObservable(lookupKey).pipe(
        switchMap(({ candidates, committeeUid, nonce, mailingListUid }) => {
          this.siblingLookupFailed.set(false);
          // The caller already has every linked list in hand (the Auto Sync drawer) — reuse it
          // instead of every open instance issuing its own identical getMailingListsByCommittee
          // request (#4899 review).
          if (candidates) {
            this.siblingLookupLoading.set(false);
            return of(candidates);
          }
          if (!committeeUid) {
            this.siblingLookupLoading.set(false);
            lastFetchKey = null;
            return of([] as GroupsIOMailingList[]);
          }
          const fetchKey = `${committeeUid}:${nonce}:${mailingListUid}`;
          if (fetchKey === lastFetchKey) {
            this.siblingLookupLoading.set(false);
            return of(lastFetchResult);
          }
          this.siblingLookupLoading.set(true);
          return this.mailingListService.getMailingListsByCommittee(committeeUid).pipe(
            map((result) => {
              // Record the key only once the request actually completes — recording it before
              // the request resolves would let a switchMap-cancelled fetch (e.g. the user moves
              // to another list in the same committee before this one returns) "poison" the key,
              // so a later request with the same fetchKey short-circuits to the stale/empty
              // lastFetchResult instead of issuing a real fetch (#4899 review).
              lastFetchKey = fetchKey;
              lastFetchResult = result;
              return result;
            }),
            catchError((error) => {
              console.error('Failed to load sibling mailing lists for sync settings', error);
              this.siblingLookupFailed.set(true);
              lastFetchKey = null;
              return of([] as GroupsIOMailingList[]);
            }),
            // `finalize` clears the loading flag on every outcome — success, the caught error
            // above, or cancellation from a newer lookup superseding this one via switchMap —
            // instead of a no-op inner switchMap that only existed to run the same side effect
            // (lfx-one review).
            finalize(() => this.siblingLookupLoading.set(false))
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
