// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, signal, Signal, TemplateRef, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  Committee,
  CommitteeAssociatedMailingListRow,
  CommitteeUpdateData,
  CreateMailingListRequest,
  GroupsIOMailingList,
  JoinMode,
  MailingListAssociationUpdateResult,
  MailingListPickerDialogResult,
  MailingListSyncPreviewDialogResult,
  ValidationError,
} from '@lfx-one/shared/interfaces';
import { CommitteeMemberVisibility, CommitteeMemberVotingStatus, MailingListSyncMode } from '@lfx-one/shared/enums';
import {
  MAILING_LIST_ACCESS_DENIED_MESSAGE,
  MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG,
  SLACK_INCOMING_WEBHOOK_URL_PATTERN,
  WG_WEEKLY_BRIEF_SLACK_FLAG,
} from '@lfx-one/shared/constants';
import { getMailingListCommitteeSync } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MailingListService } from '@services/mailing-list.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, combineLatest, defer, filter, finalize, forkJoin, map, merge, Observable, of, Subject, switchMap, take, tap } from 'rxjs';

import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';

import { MailingListSyncSettingsComponent } from '../../../mailing-lists/components/mailing-list-sync-settings/mailing-list-sync-settings.component';
import { MailingListPickerDialogComponent } from '../mailing-list-picker-dialog/mailing-list-picker-dialog.component';
import { MailingListSyncPreviewDialogComponent } from '../mailing-list-sync-preview-dialog/mailing-list-sync-preview-dialog.component';
import { CommitteeGeneralSettingsComponent } from '../committee-general-settings/committee-general-settings.component';
import { CommitteeSettingsComponent } from '../committee-settings/committee-settings.component';
import { MailingListEmailPipe } from '../../pipes/mailing-list-email.pipe';
import { MailingListTypePipe } from './pipes/mailing-list-type.pipe';

@Component({
  selector: 'lfx-committee-settings-tab',
  imports: [
    CommitteeGeneralSettingsComponent,
    CommitteeSettingsComponent,
    ButtonComponent,
    TagComponent,
    ConfirmDialogModule,
    MailingListEmailPipe,
    MailingListTypePipe,
    UiDrawerComponent,
    UiButtonComponent,
    UiNoteComponent,
    MailingListSyncSettingsComponent,
  ],
  providers: [DialogService],
  templateUrl: './committee-settings-tab.component.html',
  styleUrl: './committee-settings-tab.component.scss',
})
export class CommitteeSettingsTabComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly dialogService = inject(DialogService);
  private readonly userService = inject(UserService);
  private readonly drawerService = inject(UiDrawerService);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);

  // Outputs
  public readonly committeeUpdated = output<void>();

  // State
  public saving = signal(false);
  public deleting = signal(false);
  public savingMl = signal(false);
  public removingMlUid = signal<string | null>(null);
  /** Whether the Slack webhook "Replace" affordance is open, revealing the input for a new URL. Reset to false on a successful save, or on a committee refresh unless the control has an unsaved (dirty) edit in progress — see the constructor. */
  public editingSlackWebhookUrl = signal(false);
  /**
   * True only when the user clicked Remove (`removeSlackWebhookStaged`), not merely when the
   * control is dirty-and-empty — Replace also leaves the control empty if the user types then
   * backspaces everything, and that should NOT be treated as "delete the webhook" on save. Reset
   * to false on Cancel, on a successful save, and the moment the user types a non-empty value
   * (typing a real URL supersedes a staged removal — see the constructor's valueChanges
   * subscription). Also reset alongside `editingSlackWebhookUrl` on a committee refresh as a
   * defensive backstop, though that branch can't currently fire while true: `onRemoveSlackWebhook`
   * always marks the control dirty, so a staged removal keeps `preserveWebhookEdit` true until
   * one of the three active resets above already cleared this flag.
   */
  public slackWebhookRemovalStaged = signal(false);
  private mlLoadingInternal = signal(true);

  // Committee uid that fetchedAssociatedMailingLists()'s last successful (non-fallback) fetch
  // resolved for — undefined until the first one lands. Unlike mlLoading(), this stays true across
  // a same-committee refresh (e.g. a drawer save's refreshMl$), only going stale during an actual
  // committee switch's fetch gap — see showAutoSyncButton's doc comment (cursor #4899 review).
  private fetchedAssociatedListsCommitteeUid = signal<string | undefined>(undefined);

  // Associated-ML refresh. Drawer saves (onSyncSettingsUpdated) and retryMlRefresh fire only this
  // one; association changes also fire refreshProjectMl$.
  private refreshMl$ = new Subject<void>();

  // Subject to trigger project-ML list refresh — only emitted from association-change paths
  // (removeMailingList, saveMailingListAssociation), since only those can change which lists
  // projectMailingLists() should return (#4899 review: this used to share refreshMl$, which fired
  // on every sync-direction save too — harmless but misleading, since the comment on
  // initProjectMailingLists() below justified it via a payload dependency that no longer exists
  // now that buildMlUpdatePayload reads a freshly-fetched record instead of this cached signal).
  private refreshProjectMl$ = new Subject<void>();

  // Keeps the unlink survivable by a subsequent refresh failure: without this, a transient fetch
  // error right after an unlink would fall back to the last-good associated-list snapshot, which
  // still contains the just-removed list, silently resurrecting it (#4899 review).
  private lastGoodAssociatedLists: { uid: string; lists: GroupsIOMailingList[] } | null = null;

  // Signal (not a plain Set) so the drawer template can reactively lock sibling cards' toggles while
  // one card saves — two cards both reading a stale associatedMailingLists() snapshot could otherwise
  // pass their own "no active sync elsewhere" check and fire conflicting PUTs before either save's
  // round-trip lands (#4899 review).
  public savingMlUids = signal<ReadonlySet<string>>(new Set());
  // Count of Auto Sync drawer instances currently mid-save — closing the drawer destroys every open
  // lfx-mailing-list-sync-settings instance, tearing down its (updated) binding, so a save that's
  // still in flight would otherwise never reach onSyncSettingsUpdated() (#4899 review). Gates both
  // the drawer's canClose (Escape/backdrop/close button) and the Done button, since DialogRef.close()
  // — what Done calls — does not consult canClose. Derived from savingMlUids rather than tracked
  // separately, so a future path that resets savingMlUids can't desync the two (#4899 review).
  public drawerSavingCount = computed(() => this.savingMlUids().size);
  // True from the moment a card's save succeeds (onSyncSettingsUpdated) until the resulting
  // getMailingListsByCommittee refresh lands — savingMlUids alone unlocks sibling cards as soon as
  // the saving card's own PUT completes, before associatedMailingLists() (and each sibling's
  // activeSync()) reflects the new sync_mode, leaving a window where a second card can still submit
  // an automatic mode against stale sibling data (#4899 review, prior item partially addressed).
  public refreshingMl = signal(false);
  // Set when the refresh triggered above fails — refreshingMl is deliberately left locked on
  // failure (see initAssociatedMailingLists' catchError) rather than unlocking sibling cards
  // against stale data, which would otherwise strand every card locked forever with no way out
  // (#4899 review). Drives a retry affordance in the drawer; cleared on the next successful refresh.
  public mlRefreshFailed = signal(false);
  // Keyed by mailing list uid. Holds a sync-settings save result between the moment a drawer card
  // emits it and the next real refresh — lets the drawer and settings card reflect a just-saved
  // sync_mode immediately instead of racing the query index's eventual-consistency window via the
  // refreshMl$-triggered getMailingListsByCommittee refetch (#4899 review, same root cause as
  // #4880). Entries self-clear once a real refresh confirms the same value (see the refresh
  // pipeline's tap below), or on committee change (see the constructor).
  private readonly associatedMlOverrides = signal<ReadonlyMap<string, GroupsIOMailingList>>(new Map());

  // Mailing list uids suppressed from associatedMailingLists()/fetchedAssociatedMailingLists after a
  // successful unlink, until a refresh confirms the index no longer returns them — a successful but
  // stale getMailingListsByCommittee response (eventual-consistency lag, not a fetch error) can
  // otherwise resurrect a just-removed row and re-unlock its Auto Sync card; saving that restored
  // card would send its old committee_uid in a full-resource PUT and silently relink the list
  // (#4899 review). Cleared automatically once a refetch no longer contains the uid (see the refresh
  // pipeline's tap below), or immediately on an intentional relink of the same uid (see
  // clearUnlinkedMlSuppression's call sites), or on committee change (see the constructor).
  private readonly unlinkedMlUids = signal<ReadonlySet<string>>(new Set());

  // Mailing list uids with a genuinely pending ADD override — set only from saveMailingListAssociation's
  // success handler, for a uid in addedMlByUid, never for a config-only change on an already-linked
  // list. associatedMailingLists' pending-row synthesis (see initAssociatedMailingListsWithOverrides)
  // must only resurrect an override missing from the fetch when its uid is in this set — otherwise a
  // config-change override that never gets confirmed (the drawer-save eventual-consistency case) stays
  // in associatedMlOverrides and gets treated as "still pending" even after the same list is unlinked
  // outside this component, re-linking it the next time a toggle fires (dealako #4899 review). Cleared
  // the first time a refetch contains the uid at all (see initAssociatedMailingLists' refresh-pipeline
  // tap), or on committee change (see the constructor).
  private readonly pendingAddMlUids = signal<ReadonlySet<string>>(new Set());

  // Per-uid consecutive-miss counter for the prune loop below: a non-pending override whose uid is
  // absent from a fetch is not deleted on its first miss, only once this reaches 2. A single absence
  // could be a transient false-negative from the committee-fetch's underlying index rather than proof
  // the list was actually unlinked (dealako #4899 review — no guarantee was found that a sync_mode-only
  // PUT can't momentarily drop a still-linked list from the index). Reset for a uid the moment it
  // reappears in a fetch (see the refresh pipeline's tap below), or on committee change (see the
  // constructor).
  private readonly overrideMissCounts = signal<ReadonlyMap<string, number>>(new Map());

  // Form
  public form = new FormGroup({
    // pattern(/\S/) rejects a whitespace-only name, which `required` alone accepts and persistSettings would then silently drop.
    name: new FormControl('', [Validators.required, Validators.pattern(/\S/)]),
    // Not required: a legacy group can have no category, and an empty value is left out of the save payload, so it must not block unrelated settings.
    category: new FormControl(''),
    parent_uid: new FormControl<string | null>(null),
    member_visibility: new FormControl(''),
    join_mode: new FormControl(''),
    business_email_required: new FormControl(false),
    enable_voting: new FormControl(false),
    is_audit_enabled: new FormControl(false),
    public: new FormControl(false),
    sso_group_enabled: new FormControl(false),
    show_meeting_attendees: new FormControl(false),
    chat_channel: new FormControl<string | null>(null),
    website: new FormControl<string | null>(null),
    // Write-only — never patched from the committee (Committee.has_slack_webhook is the only
    // read signal). Reset to null when `committee` refreshes, unless the control has an unsaved
    // (dirty) edit in progress; see the constructor.
    chat_webhook_url: new FormControl<string | null>(null, [Validators.pattern(SLACK_INCOMING_WEBHOOK_URL_PATTERN)]),
  });

  // Project mailing lists (loaded when committee has a project_uid — used by the picker dialog)
  private readonly fetchedProjectMailingLists: Signal<GroupsIOMailingList[]> = this.initProjectMailingLists();

  // Associated mailing lists (queried directly by committee_uid tag)
  public readonly fetchedAssociatedMailingLists: Signal<GroupsIOMailingList[]> = this.initAssociatedMailingLists();

  // Fetched list with any pending save overrides patched in — see associatedMlOverrides' doc comment.
  // Patches only the overridden `sync_mode` onto the freshly fetched row, rather than returning the
  // override wholesale: the override is a pre-save snapshot, so returning it in full would mask
  // every other field (e.g. `writer`) the subsequent fetch actually refreshed (#4899 review).
  //
  // A pending-add override whose uid the fetch doesn't contain at all — the add-path case, where a
  // committee refetch lands before the index has the newly-linked row — is appended as its own
  // (already-patched) row rather than silently dropped. Without this, a just-added auto-sync list
  // would vanish from the card list and the drawer until a later refetch catches up, and the
  // one-auto-direction-per-committee check above would have no row to see as occupying the slot
  // (dealako #4899 review). This same replay also covers a non-pending, config-only-change override
  // during its one-miss grace window: the prune loop (see initAssociatedMailingLists) no longer
  // deletes such an override the first time a fetch misses its uid — a single absence isn't proof it
  // was unlinked outside this component rather than a transient index false-negative — so the override
  // stays in the map, and without this replay the row would vanish from the card list for that one
  // refetch before reappearing (dealako #4899 review's two-miss fallback). The row only disappears for
  // good once the prune loop actually deletes the override, on its second consecutive miss.
  //
  // A pending row still goes through `patchCommitteeSyncMode`, not just the raw override snapshot:
  // the snapshot's own `committees[]` predates the link, so it has no entry for this committee yet,
  // and `lfx-mailing-list-sync-settings` resolves its `committee()` input by scanning that array —
  // without this, the card shows the list's name with no sync controls at all (greptile, Copilot,
  // Cursor bugbot #4899 review).
  public associatedMailingLists: Signal<GroupsIOMailingList[]> = this.initAssociatedMailingListsWithOverrides();

  // Same override patch applied to the project-wide snapshot the picker reads — a drawer save (via
  // onSyncSettingsUpdated) only ever patches associatedMlOverrides, it never fires refreshProjectMl$
  // (that subject exists specifically so a sync-only save does NOT trigger this heavier project-wide
  // refetch — see initProjectMailingLists' doc comment). Without this, the picker's `mailingLists`
  // input and saveMailingListAssociation's configChanged detection both read the stale pre-drawer
  // sync_mode, so re-opening the picker right after a drawer save could issue a no-op PUT or let a
  // second list be saved as automatic (#4899 review: Greptile, Cursor bugbot, Copilot all flagged
  // this independently).
  //
  // For a list this committee is linked to, prefer associatedMailingLists()'s sync_mode over the raw
  // override map: once the associated-list refresh confirms a drawer save, it deletes the override
  // (see initAssociatedMailingLists' refresh-pipeline tap), but fetchedProjectMailingLists only
  // refetches on refreshProjectMl$ (a sync-only save never fires it), so without this the picker would
  // fall straight back to the pre-save fetched project snapshot the moment the override clears,
  // flashing the old direction and running its active-sync lock/change detection against stale data
  // (#4899 review). associatedMailingLists() already reflects whichever is current — the override
  // while pending, the confirmed fetched value once it lands — so looking it up there instead
  // supersedes the override lookup for any uid linked to this committee; a project list not linked
  // here still falls back to the raw override/fetched value.
  public projectMailingLists: Signal<GroupsIOMailingList[]> = computed(() => {
    const overrides = this.associatedMlOverrides();
    const associatedByUid = new Map(this.associatedMailingLists().map((ml) => [ml.uid, ml]));
    if (overrides.size === 0 && associatedByUid.size === 0) return this.fetchedProjectMailingLists();
    return this.fetchedProjectMailingLists().map((ml) => {
      const confirmed = associatedByUid.get(ml.uid);
      if (confirmed) return this.patchCommitteeSyncMode(ml, confirmed.sync_mode);
      const override = overrides.get(ml.uid);
      return override ? this.patchCommitteeSyncMode(ml, override.sync_mode) : ml;
    });
  });

  // Precomputed per-row state for the Settings tab's associated-mailing-list cards — avoids
  // nested ternaries and repeated ml.writer/ml.sync_mode branching in the template
  // (docs/reviews/frontend-checklist.md §4/§12, #4911 review).
  public associatedMailingListRows: Signal<CommitteeAssociatedMailingListRow[]> = this.initAssociatedMailingListRows();

  // Linking or unlinking updates the mailing list itself, so it needs write access on that list.
  // Only block once lists have loaded and none are writable — an empty list is the picker's own
  // "no mailing lists" state, which still offers Create New List.
  public mailingListLinkBlocked: Signal<boolean> = computed(() => {
    const lists = this.projectMailingLists();
    return lists.length > 0 && !lists.some((ml) => ml.writer === true);
  });

  // Derived loading state: true until first emission from associatedMailingLists
  public mlLoading = computed(() => this.mlLoadingInternal() && !!this.committee()?.uid);

  // Dark-launch gate for the whole Slack webhook card — mirrors committee-overview.component.ts's
  // 'wg-weekly-brief' flag on the brief card itself, but as its own flag. Purely a UI-visibility
  // gate: the real enforcement boundary is the server-side kill switch
  // (ServerFeatureFlag.WeeklyBriefSlack, committee.service.ts's updateCommittee — env-var only,
  // defaults off, this OpenFeature/GrowthBook flag can't reach it). Both must be on for a save to
  // actually succeed; this flag alone controls whether the card renders at all, so it stays off
  // until the feature is ready to roll out to users, independent of when the server flag flips.
  public slackWebhookEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(WG_WEEKLY_BRIEF_SLACK_FLAG, false);

  // Dark-launch gate for the "Auto Sync" entry point (#4025) — mirrors the same flag's use as the
  // sync settings section's own gate (mailing-list-sync-settings.component.ts). UI-only; see that
  // constant's doc comment for the real-time auto-sync execution kill switch tracked separately in #4878.
  public autoSyncEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG, false);

  // The "Auto Sync" button only makes sense once the committee has at least one linked mailing list
  // the viewer can actually manage sync settings on — committee canEdit() and per-list `writer`
  // access are separate permissions (see the drawer template's per-row writer gate), so with no
  // writable list the drawer would otherwise open to nothing but bare names (#4899 review). Also
  // gated on fetchedAssociatedListsCommitteeUid() matching the current committee — this component
  // instance is reused across a route navigation from one committee to another, and
  // associatedMailingLists() keeps returning the PREVIOUS committee's data until its refetch for the
  // new committee lands, so without this the button stays bound to (and can open a drawer full of)
  // the prior committee's writable lists during that gap (cursor #4899 review). Deliberately NOT
  // gated on mlLoading(), which also flips true on every same-committee refresh (e.g. a drawer save's
  // refreshMl$) — that would hide/recreate this button, and the UiModalService it opens, on every
  // save, breaking the drawer's restoreFocus return and flashing autoSyncButtonDisabled's "refreshing"
  // state the user never otherwise sees (cursor #4899 review).
  public showAutoSyncButton = computed(
    () =>
      this.autoSyncEnabled() &&
      this.canEdit() &&
      this.fetchedAssociatedListsCommitteeUid() === this.committee().uid &&
      this.associatedMailingLists().some((ml) => ml.writer === true)
  );

  // Blocks opening the drawer while an Add List/Remove association change is in flight — a sync
  // save opened against that snapshot sends a full-resource PUT with the pre-change `committee_uid`,
  // which can land after and silently undo the in-flight association change (#4899 review). Also
  // blocked while refreshingMl() — the post-save mailing-list refetch — is still in flight, so the
  // button can't unlock between a successful association PUT and that refetch completing (#4899 review).
  //
  // Exempts a *failed* refresh (mlRefreshFailed()) from that refreshingMl() block: refreshingMl stays
  // latched true until a refresh actually succeeds (see initAssociatedMailingLists' catchError), and
  // retryMlRefresh() — the only way to fire that next refresh — lives inside this same drawer. Without
  // this exemption a failed refresh permanently disables the one button that opens the drawer, locking
  // the user out of their own recovery path with no way back short of reloading the page (greptile P1,
  // cursor bugbot, copilot — #4899 review).
  public autoSyncButtonDisabled = computed(() => this.savingMl() || this.removingMlUid() !== null || (this.refreshingMl() && !this.mlRefreshFailed()));

  // Inline template passed to UiDrawerService.open() — see drawer.stories.ts for the pattern.
  public readonly autoSyncDrawerTemplate = viewChild.required<TemplateRef<unknown>>('autoSyncDrawer');

  // Dark-launch gate for the "Sync Now" preview/apply entry point on each associated mailing list
  // card — same flag as the Mailing List Settings sync toggle (#4024), so both committee/mailing-list
  // sync surfaces roll out together. Default false: unflagged, "Sync Now" stays hidden even for editors.
  public syncPreviewEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG, false);

  // Server-blocked (committee.service.ts's updateCommittee) as well — surfaced here too so the
  // control renders visible-but-disabled instead of accepting an edit that will 403, matching the
  // established pattern (weekly-brief-card, profile-panel) of gating on
  // `userService.impersonating()` directly, not on module input plumbing.
  public readonly impersonating = this.userService.impersonating;

  // Whether the committee already has a Slack webhook configured — drives the settings card's Configured/Replace vs. empty-input display.
  public slackWebhookConfigured = computed(() => !!this.committee()?.has_slack_webhook);

  // Whether the webhook-URL input is currently rendered/editable — passed straight to
  // CommitteeSettingsComponent as its single source of truth for that decision (not re-derived
  // independently in the child from two separately-passed inputs, which is how the "input
  // visible but the save didn't send it" bug happened in the first place).
  public slackWebhookInputVisible = computed(() => this.editingSlackWebhookUrl() || !this.slackWebhookConfigured());

  // Last committee uid seen by the constructor's patch subscription below — lets it tell "this
  // component instance got reused for a different committee via route param navigation" apart
  // from "the same committee's data just refreshed". Undefined only before the first emission.
  private lastCommitteeUid: string | undefined;

  // Mirrors lastCommitteeUid above, tracked separately for associatedMlOverrides' own reset subscription.
  private lastOverridesCommitteeUid: string | undefined;

  // Set while the Auto Sync drawer is open, so the committee-change reset below can force it closed
  // — this component instance is reused across a route navigation, and an open drawer left bound to
  // the previous committee's cards could otherwise keep showing (and saving against) the wrong
  // committee's mailing lists until the user happens to close it themselves (cursor #4899 review).
  private autoSyncDrawerRef: ReturnType<UiDrawerService['open']> | null = null;

  public constructor() {
    // Patch form when committee input changes
    toObservable(this.committee)
      .pipe(
        filter((c): c is Committee => !!c),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((c) => {
        // A dirty chat_webhook_url means the user has an unsaved edit in progress. Preserve it
        // across the resulting refresh instead of silently discarding what they typed; a
        // successful save already reset the control itself (see saveSettings' next handler), so
        // this only ever preserves a genuinely unsaved value.
        // But only within the SAME committee: this component instance can be reused across a
        // route navigation from one committee to another (e.g. /groups/:id -> /groups/:id2)
        // without being destroyed, and `dirty` alone can't tell that apart from a same-committee
        // refresh — an unsaved edit for committee A must never survive onto committee B's form,
        // let alone ride along into committee B's save payload.
        const committeeChanged = this.lastCommitteeUid !== undefined && this.lastCommitteeUid !== c.uid;
        this.lastCommitteeUid = c.uid;
        const preserveWebhookEdit = !committeeChanged && this.form.controls.chat_webhook_url.dirty;
        const incomingValues = {
          name: c.name,
          category: c.category,
          parent_uid: c.parent_uid ?? null,
          member_visibility: c.member_visibility || 'hidden',
          join_mode: c.join_mode || 'invite_only',
          business_email_required: c.business_email_required || false,
          enable_voting: c.enable_voting || false,
          is_audit_enabled: c.is_audit_enabled || false,
          public: c.public || false,
          sso_group_enabled: c.sso_group_enabled || false,
          show_meeting_attendees: c.show_meeting_attendees || false,
          chat_channel: c.chat_channel ?? null,
          website: c.website ?? null,
          ...(preserveWebhookEdit ? {} : { chat_webhook_url: null }),
        };
        // On a same-committee refresh (e.g. after a reverse mailing-list sync via openSyncPreviewDialog),
        // drop any field the admin has a dirty, unsaved edit on from the patch instead of clobbering it —
        // chat_webhook_url already got this treatment above; this extends it to every other control
        // (copilot, #4911 review). A committee-changed navigation still fully repatches: an unsaved edit
        // for committee A must never survive onto committee B's form.
        const patchValues = committeeChanged
          ? incomingValues
          : (Object.fromEntries(Object.entries(incomingValues).filter(([key]) => !this.form.get(key)?.dirty)) as typeof incomingValues);
        this.form.patchValue(patchValues);
        if (!preserveWebhookEdit) {
          this.editingSlackWebhookUrl.set(false);
          this.slackWebhookRemovalStaged.set(false);
        }
      });

    // Typing a non-empty value after clicking Remove means the user changed their mind and is
    // entering a replacement URL instead — the staged removal no longer applies, and saveSettings'
    // payload gate must go back to keying off the typed value rather than the removal flag.
    this.form.controls.chat_webhook_url.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      if (value) {
        this.slackWebhookRemovalStaged.set(false);
      }
    });

    // Disable form fields for read-only (Auditor) access, and — independently — keep
    // chat_webhook_url specifically disabled during impersonation even when the rest of the form
    // is editable. Server-side, committee.service.ts's updateCommittee rejects the *whole request*
    // when chat_webhook_url is present during impersonation, not just that field — disabling only
    // this one control client-side keeps the rest of the form saveable by simply excluding the
    // webhook value from what saveSettings sends (it's gated on the control's own dirty flag,
    // which a disabled-but-untouched control never sets). form.enable() re-enables every child
    // control including chat_webhook_url, so the impersonation re-disable must run after it, in
    // the same subscription, rather than as a separate independent one that could race.
    combineLatest([toObservable(this.canEdit), toObservable(this.impersonating)])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([editable, impersonating]) => {
        if (editable) {
          this.form.enable();
          if (impersonating) {
            this.form.controls.chat_webhook_url.disable();
          }
        } else {
          this.form.disable();
        }
      });

    // Clear any pending save overrides when the committee itself changes (route navigation reusing
    // this component instance) — an override keyed by mailing list uid could otherwise leak a stale
    // sync_mode onto an unrelated committee's list of the same uid (#4899 review).
    toObservable(this.committee)
      .pipe(
        filter((c): c is Committee => !!c?.uid),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((c) => {
        if (this.lastOverridesCommitteeUid !== undefined && this.lastOverridesCommitteeUid !== c.uid) {
          this.associatedMlOverrides.set(new Map());
          // Same leak as the override above — a suppressed uid from a different committee must not
          // hide an unrelated mailing list of the same uid on this one (#4899 review).
          this.unlinkedMlUids.set(new Set());
          // Same leak as both overrides above — a pending-add marking from a different committee must
          // not treat an unrelated mailing list of the same uid on this one as still pending (#4899 review).
          this.pendingAddMlUids.set(new Set());
          // Same leak as the state above — a miss count accrued against a uid on the previous
          // committee must not prune an unrelated mailing list of the same uid on this one (dealako
          // #4899 review).
          this.overrideMissCounts.set(new Map());
          // Force-close any drawer left open from the previous committee — see autoSyncDrawerRef's
          // doc comment (cursor #4899 review). Bypasses canClose deliberately: a card's in-flight PUT
          // is fire-and-forget (see MailingListSyncSettingsComponent.save) and still completes against
          // the previous committee; its destroyed child drops the (updated) emit, so clearing
          // savingMlUids here is safe even if a save was still running (dealako #4899 review).
          this.autoSyncDrawerRef?.close();
          this.savingMlUids.set(new Set());
        }
        this.lastOverridesCommitteeUid = c.uid;
      });
  }

  public openAutoSyncDrawer(): void {
    const ref = this.drawerService.open(this.autoSyncDrawerTemplate(), {
      width: 600,
      // Blocks Escape/backdrop/close-button dismissal while any card's save is in flight (#4899 review).
      canClose: () => this.drawerSavingCount() === 0,
    });
    this.autoSyncDrawerRef = ref;
    // `ref.closed` fires on every closure path, including an external disposal (e.g. browser Back)
    // that bypasses canClose — reset savingMlUids so a card's in-flight save can't leave
    // drawerSavingCount stuck non-empty for this component instance's next drawer open (#4899 review).
    ref.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.savingMlUids.set(new Set());
      if (this.autoSyncDrawerRef === ref) {
        this.autoSyncDrawerRef = null;
      }
    });
  }

  // Tracks how many open Auto Sync drawer cards are currently saving, keyed by whether this
  // particular instance's own saving state just turned on or off (not a plain increment/decrement,
  // since a misordered pair of emissions from the same instance must not leave the count permanently
  // off by one).
  public onSyncSettingsSavingChange(mlUid: string, saving: boolean): void {
    const next = new Set(this.savingMlUids());
    if (saving) {
      next.add(mlUid);
    } else {
      next.delete(mlUid);
    }
    this.savingMlUids.set(next);
  }

  // Patches the saved sync_mode into associatedMailingLists() via associatedMlOverrides so every open
  // drawer card's siblingCandidates (and activeSync) updates at once, then triggers a refetch to
  // reconcile with the server (#4899 review).
  public onSyncSettingsUpdated(updated: GroupsIOMailingList): void {
    // Apply the save result directly rather than waiting on the refetch below — getMailingListsByCommittee
    // reads an eventually-consistent query index, so the refresh triggered here can briefly return the
    // pre-save sync_mode (#4899 review, same root cause as #4880's mailingListOverride pattern).
    const next = new Map(this.associatedMlOverrides());
    next.set(updated.uid, updated);
    this.associatedMlOverrides.set(next);

    this.refreshingMl.set(true);
    this.refreshMl$.next();
  }

  // Re-fires the refresh that failed in initAssociatedMailingLists' catchError — the only recovery
  // path once refreshingMl is latched true with no successful refresh to clear it (#4899 review).
  public retryMlRefresh(): void {
    this.refreshingMl.set(true);
    this.refreshMl$.next();
  }

  public openMailingListPicker(): void {
    const committee = this.committee();
    const committeeUid = committee.uid;
    const projectUid = committee.project_uid;

    this.committeeService
      .getCommittee(committeeUid)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fresh) => {
          if (fresh?.writer !== true) {
            // Stay on the Settings tab rather than redirecting away from it.
            this.messageService.add({ severity: 'warn', summary: 'Access Denied', detail: MAILING_LIST_ACCESS_DENIED_MESSAGE });
            return;
          }
          this.openPickerDialog(committeeUid, projectUid, fresh?.project_slug ?? committee.project_slug);
        },
        error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Unable to verify your access. Please try again.' }),
      });
  }

  public openSyncPreviewDialog(ml: GroupsIOMailingList): void {
    // closable: true from the start — lockDynamicDialogWhile (inside the dialog) flips
    // config.closable to false while the diff is loading, while applying, while the apply result
    // (success or error) is on screen, so the header X and Escape are blocked during those
    // windows. PrimeNG's Dialog only reads closeOnEscape/closable once, at open, to bind its
    // Escape listener — opening with closable: false here would mean Escape can never be rebound
    // later even once lockDynamicDialogWhile flips it back to true (#4911 review).
    const ref: DynamicDialogRef<MailingListSyncPreviewDialogComponent> | null = this.dialogService.open(MailingListSyncPreviewDialogComponent, {
      header: `Sync Now — ${ml.group_name}`,
      width: '800px',
      modal: true,
      closable: true,
      draggable: false,
      data: { mailingListUid: ml.uid, mailingListName: ml.group_name, committeeUid: this.committee().uid },
    });

    if (!ref) return;

    ref.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: MailingListSyncPreviewDialogResult | null) => {
      this.refreshMl$.next();
      // Only a reverse sync (mailing list → committee) can change committee membership —
      // committeeUpdated triggers the parent's onSettingsSaved(), which refetches the committee and
      // repatches the Settings form. The same-committee dirty filter (constructor) now keeps any
      // in-flight unsaved edit intact across that repatch, but a reverse sync is still the only
      // reason to pay for the cache-bypassing refetch at all — a forward sync, a Cancel, or a
      // load/apply error didn't touch committee membership, so there's nothing new to fetch
      // (#4911 review).
      if (result?.committeeChanged) {
        this.committeeUpdated.emit();
      }
    });
  }

  public removeMailingList(ml: GroupsIOMailingList): void {
    const committee = this.committee();
    if (!committee?.uid || this.removingMlUid()) return;

    this.removingMlUid.set(ml.uid);

    this.mailingListService
      .updateMailingList(ml.uid, this.buildMlUpdatePayload(ml, null))
      .pipe(finalize(() => this.removingMlUid.set(null)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Removed', detail: `${ml.group_name} removed from this group` });
          this.clearMlOverride(ml.uid);
          this.pruneLastGoodAssociatedList(ml.uid);
          this.suppressUnlinkedMl(ml.uid);
          // Locked before refreshMl$ fires — autoSyncButtonDisabled must stay disabled across the
          // gap between this successful PUT and the refetch it triggers settling (#4899 review).
          this.refreshingMl.set(true);
          this.refreshMl$.next();
          this.refreshProjectMl$.next();
        },
        error: (err: any) => {
          const detail = this.getMlErrorDetail(err, `Failed to remove ${ml.group_name}`);
          this.messageService.add({ severity: 'error', summary: 'Error', detail });
        },
      });
  }

  public confirmDelete(): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to permanently delete "${this.committee().name}"? This will remove all associated meetings, votes, surveys, and member records. This action cannot be undone.`,
      header: 'Delete Group',
      icon: 'fa-light fa-triangle-exclamation',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-outlined p-button-sm',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        this.deleting.set(true);
        this.committeeService
          .deleteCommittee(this.committee().uid)
          .pipe(finalize(() => this.deleting.set(false)))
          .subscribe({
            next: () => {
              this.messageService.add({ severity: 'success', summary: 'Deleted', detail: `"${this.committee().name}" has been deleted` });
              this.router.navigate(['/', 'groups']);
            },
            error: () => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete group' });
            },
          });
      },
    });
  }

  /** Saves the form; a changed type is confirmed first because it re-labels the group and every member record. */
  public saveSettings(): void {
    const currentCategory = this.committee().category;
    const nextCategory = this.form.getRawValue().category;
    if (!nextCategory || nextCategory === currentCategory) {
      this.persistSettings();
      return;
    }

    this.confirmationService.confirm({
      message: `Change the type of "${this.committee().name}"${currentCategory ? ` from ${currentCategory}` : ''} to ${nextCategory}? This updates how the group is labeled and governed, including on its members' records.`,
      header: 'Change Group Type',
      icon: 'fa-light fa-triangle-exclamation',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-outlined p-button-sm',
      acceptLabel: 'Change Type',
      rejectLabel: 'Cancel',
      accept: () => this.persistSettings(),
    });
  }

  private persistSettings(): void {
    this.saving.set(true);
    const values = this.form.getRawValue();
    // Gated on the control's own dirty flag, not on whether the input happens to be rendered —
    // patchValue (constructor) never marks a control dirty, only a real user edit does, so this
    // is "the user actually typed something" rather than "the input was visible". Gating on
    // visibility alone would send chat_webhook_url: null on every save for a not-yet-configured
    // committee (untouched or not), forcing a needless read-back round trip and risking
    // clobbering a webhook someone else configured after this page loaded.
    //
    // A dirty-but-empty control is ambiguous on its own: it's what an explicit Remove looks
    // like, but it's also what Replace looks like if the user types then backspaces everything
    // without hitting Cancel. Requiring either a real typed value OR the explicit
    // slackWebhookRemovalStaged flag (set only by Remove — see that signal's doc comment) keeps
    // the latter case from silently deleting an already-configured webhook.
    //
    // `.enabled`, not just `.dirty`: getRawValue() (unlike .value) includes disabled controls'
    // values, and disable() never clears .dirty — so a URL typed before impersonation starts
    // stays dirty and present in `values` even after the impersonation subscription above
    // disables the control. Without this check, that stale value would still be sent, and the
    // server rejects the *entire* request (IMPERSONATION_READ_ONLY), blocking every other field
    // on the same save over a value the user can no longer edit or even see change.
    //
    // Captured once, reused in both the payload below AND the success handler: the success
    // handler resetting the control whenever it's merely *dirty* (regardless of whether this
    // save actually included it) would silently wipe out a URL that was excluded by the
    // `.enabled` check above — the user typed it, it was never sent, and then it vanished from
    // the form too, on a save of completely unrelated fields.
    const chatWebhookUrlIncludedInSave = !!(
      this.form.controls.chat_webhook_url.enabled &&
      this.form.controls.chat_webhook_url.dirty &&
      (values.chat_webhook_url || this.slackWebhookRemovalStaged())
    );
    // name / type / parent are sent only when they differ from the loaded committee. The server merges
    // the payload over the latest record, so echoing untouched values from a stale page would silently
    // revert another writer's change (and a reverted type would skip the confirmation above, which
    // compares against that same stale page data).
    const committee = this.committee();
    const name = values.name?.trim();
    const parentUid = values.parent_uid || null;
    const changedGeneralFields: Pick<CommitteeUpdateData, 'name' | 'category' | 'parent_uid'> = {
      ...(name && name !== committee.name ? { name } : {}),
      ...(values.category && values.category !== committee.category ? { category: values.category } : {}),
      ...(parentUid !== (committee.parent_uid || null) ? { parent_uid: parentUid } : {}),
    };
    this.committeeService
      .updateCommittee(committee.uid, {
        ...changedGeneralFields,
        member_visibility: (values.member_visibility as CommitteeMemberVisibility) || undefined,
        join_mode: (values.join_mode as JoinMode) || undefined,
        business_email_required: values.business_email_required ?? false,
        enable_voting: values.enable_voting ?? false,
        is_audit_enabled: values.is_audit_enabled ?? false,
        public: values.public ?? false,
        sso_group_enabled: values.sso_group_enabled ?? false,
        show_meeting_attendees: values.show_meeting_attendees ?? false,
        chat_channel: values.chat_channel || null,
        website: values.website || null,
        ...(chatWebhookUrlIncludedInSave ? { chat_webhook_url: values.chat_webhook_url || null } : {}),
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Settings saved' });
          // Reset locally rather than relying on the refresh triggered by the emit below — that
          // refresh is async (a refetch round-trip) and its timing shouldn't be what keeps this
          // control's dirty/value state correct. Only when this save actually included the
          // webhook — see chatWebhookUrlIncludedInSave's comment above.
          if (chatWebhookUrlIncludedInSave) {
            this.form.controls.chat_webhook_url.reset(null);
            this.editingSlackWebhookUrl.set(false);
            this.slackWebhookRemovalStaged.set(false);
          }
          // Mark every other successfully-saved control pristine, only if its current value still
          // equals what was actually submitted. Without this, the constructor's same-committee
          // dirty filter (above) treats a saved control as "still has an unsaved edit" forever —
          // the server-normalized value never lands, and a later unrelated save resends the stale
          // value, reverting any change another writer made in between (cursor, greptile, copilot,
          // dealako [blocking], #4911 review). Checking against `values` (captured at submit time)
          // rather than unconditionally resetting dirty keeps a genuinely new edit — typed while
          // this request was still in flight — marked dirty, since that one was never submitted.
          Object.keys(values).forEach((key) => {
            if (key === 'chat_webhook_url') return;
            const control = this.form.get(key);
            if (control?.dirty && control.value === (values as Record<string, unknown>)[key]) {
              control.markAsPristine();
            }
          });
          this.committeeUpdated.emit();
        },
        error: (err: any) => {
          const code = err?.error?.code;
          const status = err?.status;
          let detail = 'Failed to save settings';
          if (status === 403 && code === 'IMPERSONATION_READ_ONLY') {
            // Backstop only — the control is already disabled during impersonation (see the
            // constructor's combineLatest subscription), so this path shouldn't normally be
            // reachable from this form. Kept for direct-API-caller parity with the server guard.
            detail = 'Configuring the Slack webhook is unavailable while impersonating another user.';
          } else if (status === 403 && code === 'NOT_PROJECT_WRITER') {
            // Unlike IMPERSONATION_READ_ONLY above, this one IS reachable from this form: canEdit
            // (committee-view.component.ts) is true for a direct committee-writer grant, which
            // updateCommittee's project-writer check on chat_webhook_url (committee.service.ts)
            // does not accept — a committee writer without project-writer access sees an editable
            // field with no reliable client-side signal to disable it against (see that commit's
            // PR-description trade-off note). This branch is the only explanation the user gets.
            // Explicit "nothing was saved" clause: unlike the 409 branch above, this check runs
            // before updateWithETag/updateCommitteeSettings, so every other field on this same
            // save (visibility, join mode, chat_channel, etc.) was rejected too, not just the
            // webhook — without saying so, this reads like the 409 branch's "other changes saved".
            detail = 'Only project writers can configure the Slack webhook. No changes were saved. Contact a project administrator.';
          } else if (status === 409 && code === 'FEATURE_DISABLED') {
            // committee.service.ts's ServerFeatureFlag.WeeklyBriefSlack kill switch — checked
            // first in updateCommittee, before any write, so — like NOT_PROJECT_WRITER above —
            // nothing on this save persisted, not just the webhook field.
            detail = 'Slack webhook sharing is not enabled in this environment yet. No changes were saved.';
          } else if (status === 400) {
            const fieldErrors = err?.error?.errors as ValidationError[] | undefined;
            detail = fieldErrors?.[0]?.message ?? detail;
          }
          this.messageService.add({ severity: 'error', summary: 'Error', detail });
        },
      });
  }

  // -- Private methods --

  // Drops a pending save override for a uid that just got unlinked — otherwise a stale automatic
  // direction survives the unlink and resurfaces if the same list is relinked later in the session,
  // since reconciliation (see associatedMlOverrides' refresh-pipeline tap) only inspects rows the
  // fetch still returns (#4899 review).
  private clearMlOverride(uid: string): void {
    const overrides = this.associatedMlOverrides();
    if (!overrides.has(uid)) return;
    const next = new Map(overrides);
    next.delete(uid);
    this.associatedMlOverrides.set(next);
  }

  // See lastGoodAssociatedLists' doc comment above — called alongside clearMlOverride() from every
  // unlink path so a refresh failure right after can't resurrect the list that was just removed.
  private pruneLastGoodAssociatedList(uid: string): void {
    if (!this.lastGoodAssociatedLists) return;
    this.lastGoodAssociatedLists = { ...this.lastGoodAssociatedLists, lists: this.lastGoodAssociatedLists.lists.filter((l) => l.uid !== uid) };
  }

  // See unlinkedMlUids' doc comment above — called alongside clearMlOverride()/pruneLastGoodAssociatedList()
  // from every successful unlink path so a stale-but-successful refetch can't resurrect the removed row.
  private suppressUnlinkedMl(uid: string): void {
    const uids = this.unlinkedMlUids();
    if (uids.has(uid)) return;
    const next = new Set(uids);
    next.add(uid);
    this.unlinkedMlUids.set(next);
  }

  // Lifts the suppression set by suppressUnlinkedMl() above the moment the same uid is intentionally
  // relinked (via the Add List picker), so the just-relinked row isn't hidden by a leftover suppression
  // from an earlier unlink in the same session (#4899 review).
  private clearUnlinkedMlSuppression(uid: string): void {
    const uids = this.unlinkedMlUids();
    if (!uids.has(uid)) return;
    const next = new Set(uids);
    next.delete(uid);
    this.unlinkedMlUids.set(next);
  }

  // Marks a uid as a genuinely pending add — see pendingAddMlUids' doc comment. Called only from
  // saveMailingListAssociation's success handler, for a uid present in addedMlByUid.
  private markPendingAddMl(uid: string): void {
    const uids = this.pendingAddMlUids();
    if (uids.has(uid)) return;
    const next = new Set(uids);
    next.add(uid);
    this.pendingAddMlUids.set(next);
  }

  private openPickerDialog(committeeUid: string, projectUid: string, projectSlug: string | undefined): void {
    const associatedUids = new Set(this.associatedMailingLists().map((ml) => ml.uid));

    const ref = this.dialogService.open(MailingListPickerDialogComponent, {
      header: 'Associated Mailing Lists',
      width: '700px',
      modal: true,
      closable: true,
      draggable: false,
      data: {
        mailingLists: this.projectMailingLists(),
        associatedUids,
        projectUid,
        projectSlug,
        committeeUid,
      },
    }) as DynamicDialogRef;

    ref.onClose.pipe(take(1)).subscribe((result: MailingListPickerDialogResult | null) => {
      if (!result) return;
      this.saveMailingListAssociation(result.selectedUids, associatedUids, result.syncModes, result.committeeFilters, result.committeeRoleFilters);
    });
  }

  private saveMailingListAssociation(
    currentSelection: Set<string>,
    originalSelectedUids: Set<string>,
    syncModes: Map<string, MailingListSyncMode>,
    committeeFilters = new Map<string, CommitteeMemberVotingStatus[]>(),
    committeeRoleFilters = new Map<string, string[]>()
  ): void {
    const committee = this.committee();
    if (!committee?.uid) return;

    const added = [...currentSelection].filter((uid) => !originalSelectedUids.has(uid));
    const removed = [...originalSelectedUids].filter((uid) => !currentSelection.has(uid));
    // Lists that stay linked across this save but may have had only their sync direction, or
    // (#4026 criterion 3) committee/role filters, changed in the picker dialog — `added`/`removed`
    // above only cover link/unlink, so a config-only change here needs its own update call.
    const configChanged = [...currentSelection]
      .filter((uid) => originalSelectedUids.has(uid))
      .filter((uid) => {
        const desiredSync = syncModes.get(uid);
        const ml = this.projectMailingLists().find((m) => m.uid === uid) ?? this.associatedMailingLists().find((m) => m.uid === uid);
        // The read model stores sync_mode/filters per-entry inside ml.committees[], not as
        // top-level fields on the mailing list — getMailingListCommitteeSync resolves the entry
        // for THIS committee instead of reading the (always-empty-on-reads) top-level fields.
        const persisted = getMailingListCommitteeSync(ml, committee.uid);
        if (desiredSync !== undefined && desiredSync !== (persisted.syncMode ?? MailingListSyncMode.MANUAL)) return true;
        const desiredFilters = committeeFilters.get(uid);
        if (desiredFilters !== undefined && !this.arraysEqualAsSets(desiredFilters, persisted.committeeFilters)) return true;
        const desiredRoleFilters = committeeRoleFilters.get(uid);
        if (desiredRoleFilters !== undefined && !this.arraysEqualAsSets(desiredRoleFilters, persisted.committeeRoleFilters)) return true;
        return false;
      });

    if (added.length === 0 && removed.length === 0 && configChanged.length === 0) {
      return;
    }

    // The backend only allows one active auto-sync list per committee, so at most one list in this
    // batch can be releasing that slot (moving off an auto mode it previously held). With per-list
    // direction editing (#4026), a single save can both release that slot and activate a different
    // list into it in the same batch — firing all of those PUTs through one flat forkJoin races
    // them, so an activation can land before its paired release, or succeed even though the release
    // failed. Bucket by outcome and sequence releases before activations instead.
    //
    // Only the slot-releasing update gates activation: an unrelated release in the same batch (e.g.
    // a new list linked as Manual, or an unlink that was never auto-synced) has nothing an
    // activation depends on, so its failure must not block activations that don't need it.
    const releaseUpdates: { uid: string; result$: Observable<MailingListAssociationUpdateResult>; releasesAutoSyncSlot: boolean }[] = [];
    const activateUpdates: { uid: string; result$: Observable<MailingListAssociationUpdateResult> }[] = [];

    // currentlyOnThisCommittee distinguishes a list already linked to committee.uid (whose AUTO
    // sync_mode, if any, occupies *this* committee's slot) from one only found via
    // projectMailingLists() (a project-wide lookup) that may be AUTO-synced to a *different*
    // committee — re-associating that list to this committee doesn't free a slot on this
    // committee, so it must never gate this save's activations.
    const queueUpdate = (
      uid: string,
      committeeUid: string | null,
      explicitSyncMode: MailingListSyncMode | undefined,
      explicitCommitteeFilters: CommitteeMemberVotingStatus[] | undefined,
      explicitCommitteeRoleFilters: string[] | undefined,
      currentSyncMode: MailingListSyncMode | undefined,
      currentlyOnThisCommittee: boolean
    ): void => {
      // Deferred so the fresh fetch and the update call — and thus any mock/spy recording them —
      // fire only when this observable is actually subscribed (forkJoin for releases immediately,
      // but for activations only inside the switchMap below, once releases have resolved), not
      // when it's merely built. Fetching fresh immediately before building the payload avoids
      // resurrecting a stale sync_mode from a cached projectMailingLists()/associatedMailingLists()
      // snapshot that can predate another writer's change, e.g. a sync_mode flip from the Auto Sync
      // drawer (#4899 review).
      const result$ = defer(() =>
        this.mailingListService
          .getMailingList(uid, { skipCache: true })
          .pipe(
            switchMap((ml) =>
              this.mailingListService.updateMailingList(
                uid,
                this.buildMlUpdatePayload(ml, committeeUid, explicitSyncMode, explicitCommitteeFilters, explicitCommitteeRoleFilters)
              )
            )
          )
      ).pipe(
        map(() => ({ uid, success: true })),
        catchError((err: { status?: number }) => of({ uid, success: false, status: err?.status }))
      );
      if (explicitSyncMode && explicitSyncMode !== MailingListSyncMode.MANUAL) {
        activateUpdates.push({ uid, result$ });
      } else {
        const releasesAutoSyncSlot = currentlyOnThisCommittee && !!currentSyncMode && currentSyncMode !== MailingListSyncMode.MANUAL;
        releaseUpdates.push({ uid, result$, releasesAutoSyncSlot });
      }
    };

    // Associate: set committee_uid on newly selected MLs, applying any direction chosen for it
    // in the same dialog session (#4026) — buildMlUpdatePayload falls back to MANUAL when no
    // explicit direction was chosen (e.g. the sync settings feature flag is off). A newly added
    // list is by definition not currently on this committee, so it can never be releasing this
    // committee's slot.
    // Tracked by uid, same as configChangedMlByUid below, so a successful add with an explicit
    // sync_mode also gets patched into associatedMlOverrides — otherwise a newly-added list with an
    // automatic direction fell back through to a stale getMailingListsByCommittee refetch that could
    // still show it as Manual, letting the drawer activate a second auto-sync list and violate the
    // one-auto-direction-per-committee rule this overlay exists to protect (cursor/copilot #4899 review).
    const addedMlByUid = new Map<string, GroupsIOMailingList>();
    for (const uid of added) {
      const ml = this.projectMailingLists().find((m) => m.uid === uid);
      if (ml) {
        addedMlByUid.set(uid, ml);
        queueUpdate(
          uid,
          committee.uid,
          syncModes.get(uid),
          committeeFilters.get(uid),
          committeeRoleFilters.get(uid),
          getMailingListCommitteeSync(ml, committee.uid).syncMode,
          false
        );
      }
    }

    // Disassociate: clear committee_uid on deselected MLs
    for (const uid of removed) {
      const ml = this.projectMailingLists().find((m) => m.uid === uid) ?? this.associatedMailingLists().find((m) => m.uid === uid);
      if (ml) {
        queueUpdate(uid, null, undefined, undefined, undefined, getMailingListCommitteeSync(ml, committee.uid).syncMode, true);
      }
    }

    // Config-only change: the list stays linked to this same committee, only its sync_mode and/or
    // committee/role filters (#4026 criterion 3) move. Tracked by uid so a successful save can patch
    // associatedMlOverrides below, the same way onSyncSettingsUpdated() does for the Auto Sync drawer
    // — otherwise a pending override from an earlier drawer save would keep masking this dialog's new
    // mode until the next refresh happens to return it (Greptile #4899 review: "Drawer keeps an old mode").
    const configChangedMlByUid = new Map<string, GroupsIOMailingList>();
    for (const uid of configChanged) {
      const ml = this.projectMailingLists().find((m) => m.uid === uid) ?? this.associatedMailingLists().find((m) => m.uid === uid);
      if (ml) {
        configChangedMlByUid.set(uid, ml);
        queueUpdate(
          uid,
          committee.uid,
          syncModes.get(uid),
          committeeFilters.get(uid),
          committeeRoleFilters.get(uid),
          getMailingListCommitteeSync(ml, committee.uid).syncMode,
          true
        );
      }
    }

    if (releaseUpdates.length === 0 && activateUpdates.length === 0) {
      return;
    }

    const runReleases$ = releaseUpdates.length > 0 ? forkJoin(releaseUpdates.map((u) => u.result$)) : of<MailingListAssociationUpdateResult[]>([]);

    this.savingMl.set(true);
    runReleases$
      .pipe(
        switchMap((releaseResults) => {
          if (activateUpdates.length === 0) {
            return of(releaseResults);
          }
          const failedSlotRelease = releaseResults.find((r, i) => releaseUpdates[i].releasesAutoSyncSlot && !r.success);
          if (failedSlotRelease) {
            // Skip the activations outright — activating a new auto-sync slot is only safe once we
            // know the slot it depends on was actually released. Carry the triggering failure's
            // status onto each skipped placeholder so a 403 slot-release still surfaces as
            // permission-denied rather than the generic error below.
            const skipped: MailingListAssociationUpdateResult[] = activateUpdates.map((u) => ({
              uid: u.uid,
              success: false,
              status: failedSlotRelease.status,
            }));
            return of([...releaseResults, ...skipped]);
          }
          return forkJoin(activateUpdates.map((u) => u.result$)).pipe(map((activateResults) => [...releaseResults, ...activateResults]));
        }),
        finalize(() => this.savingMl.set(false))
      )
      .subscribe({
        next: (results) => {
          const failed = results.filter((r) => !r.success).length;
          const succeeded = results.filter((r) => r.success).length;
          // The committee can switch mid-flight (route navigation reusing this component instance)
          // while this save's HTTP calls are still in flight — the constructor's committee-switch
          // effect already resets associatedMlOverrides/unlinkedMlUids/pendingAddMlUids for the new
          // committee, so writing into those maps here afterwards would resurrect state for a
          // committee the user has already navigated away from (dealako #4899 review).
          const stillSameCommittee = this.committee()?.uid === committee.uid;
          if (stillSameCommittee) {
            // Same override-invalidation reasoning as removeMailingList() above — a disassociation
            // made through the picker dialog must not leave a stale pending direction behind either
            // (#4899 review).
            const removedUids = new Set(removed);
            for (const r of results) {
              if (r.success && removedUids.has(r.uid)) {
                this.clearMlOverride(r.uid);
                this.pruneLastGoodAssociatedList(r.uid);
                this.suppressUnlinkedMl(r.uid);
              }
            }
            // An intentional relink (via this same picker) must not stay hidden behind a leftover
            // suppression from an earlier unlink in this session (#4899 review — see
            // clearUnlinkedMlSuppression's doc comment).
            const addedUids = new Set(added);
            for (const r of results) {
              if (r.success && addedUids.has(r.uid)) {
                this.clearUnlinkedMlSuppression(r.uid);
              }
            }
            // Replace (not just clear) the override for a successful direction change — leaving it
            // cleared would fall straight back through to the pre-save fetched value until the next
            // refresh resolves, flashing the old mode (Greptile #4899 review: "Drawer keeps an old mode").
            // Covers both a config-only change and a brand-new add with an explicit direction — see
            // addedMlByUid's doc comment above (cursor/copilot #4899 review).
            for (const r of results) {
              if (!r.success) continue;
              const ml = configChangedMlByUid.get(r.uid) ?? addedMlByUid.get(r.uid);
              const desired = ml ? syncModes.get(r.uid) : undefined;
              if (ml && desired !== undefined) {
                const overrides = new Map(this.associatedMlOverrides());
                overrides.set(r.uid, { ...ml, sync_mode: desired });
                this.associatedMlOverrides.set(overrides);
                // Only an add-path override is a genuinely pending row — see pendingAddMlUids' doc
                // comment (dealako #4899 review).
                if (addedMlByUid.has(r.uid)) {
                  this.markPendingAddMl(r.uid);
                }
              }
            }
          }
          if (failed === 0) {
            this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Mailing list associations updated' });
          } else if (succeeded > 0) {
            this.messageService.add({ severity: 'warn', summary: 'Partial Success', detail: `${succeeded} updated, ${failed} failed` });
          } else if (results.every((r) => r.success || r.status === 403)) {
            this.messageService.add({
              severity: 'error',
              summary: 'Permission denied',
              detail: 'You need Manage access to these mailing lists to link or unlink them. No changes were saved.',
            });
          } else {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update mailing list associations' });
          }
          // Locked before refreshMl$ fires — see removeMailingList's identical comment (#4899 review).
          this.refreshingMl.set(true);
          this.refreshMl$.next();
          this.refreshProjectMl$.next();
        },
      });
  }

  private getMlErrorDetail(err: any, fallback: string): string {
    if (err?.status === 403) {
      return 'You need Manage access to this mailing list to link or unlink it.';
    }
    const body = err?.error;
    if (body?.error?.includes?.('subgroup not found') || body?.code === 'NOT_FOUND') {
      return 'Mailing list sync failed — the Groups.io subgroup may not exist for this list';
    }
    return fallback;
  }

  // Patches an overridden sync_mode onto BOTH the top-level field (read by the drawer's
  // `lfx-mailing-list-sync-settings` child) and this committee's entry in `committees[]` (read by
  // `getMailingListCommitteeSync` and the picker's `configChanged` detection) — an override that
  // only touched the top-level field left the picker seeded from the stale pre-save direction, since
  // the indexed read model never populates that field and every other reader resolves through
  // `committees[]` instead (#4899 review).
  //
  // Appends a new entry when this committee has none yet, rather than only remapping an existing
  // one — a just-added list's fetched `committees[]` can still be missing this committee's row until
  // the indexed read catches up with the association, and a plain `.map` would silently drop the
  // override on the floor in that case, leaving `getMailingListCommitteeSync` resolving undefined
  // and the picker treating the auto-sync slot as free indefinitely if a later refetch never lands
  // the row either (cursor bugbot #4899 review).
  private patchCommitteeSyncMode(ml: GroupsIOMailingList, mode: MailingListSyncMode | undefined): GroupsIOMailingList {
    const committeeUid = this.committee().uid;
    const committees = ml.committees ?? [];
    const hasEntry = committees.some((c) => c.uid === committeeUid);
    return {
      ...ml,
      sync_mode: mode,
      committees: hasEntry
        ? committees.map((c) => (c.uid === committeeUid ? { ...c, sync_mode: mode } : c))
        : [...committees, { uid: committeeUid, sync_mode: mode }],
    };
  }

  /** Order-insensitive array equality, used to detect a no-op committee/role filter change (#4026 criterion 3). */
  private arraysEqualAsSets(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every((value) => setB.has(value));
  }

  private buildMlUpdatePayload(
    ml: GroupsIOMailingList,
    committeeUid: string | null,
    explicitSyncMode?: MailingListSyncMode,
    explicitCommitteeFilters?: CommitteeMemberVotingStatus[],
    explicitCommitteeRoleFilters?: string[]
  ): Partial<CreateMailingListRequest> {
    // Preserve the existing sync direction (#4024) only when the committee is unchanged —
    // detaching/reattaching the SAME committee is a full-resource PUT, so omitting sync_mode would
    // silently reset it to manual. Re-linking to a DIFFERENT committee must reset to manual instead,
    // or auto-sync would silently start against a committee nobody configured it for (#4880 review).
    //
    // `explicitSyncMode` lets the picker dialog's per-list direction control (#4026) win over both
    // of those defaults — it's only populated (non-undefined) when the admin actually chose a
    // direction with the sync settings feature flag on, so an unset value here always falls back
    // to the #4024/#4880 behavior above untouched.
    const sameCommittee = !!committeeUid && ml.committees?.[0]?.uid === committeeUid;
    // The read model stores sync_mode/filters per-entry inside ml.committees[], not as top-level
    // fields on the mailing list — getMailingListCommitteeSync resolves the entry for THIS
    // committee instead of reading the (always-empty-on-reads) top-level fields directly.
    const persisted = sameCommittee ? getMailingListCommitteeSync(ml, committeeUid) : undefined;
    let syncMode: MailingListSyncMode | undefined;
    if (explicitSyncMode !== undefined) {
      syncMode = explicitSyncMode;
    } else if (sameCommittee) {
      syncMode = persisted?.syncMode;
    } else if (committeeUid) {
      syncMode = MailingListSyncMode.MANUAL;
    }

    // Committee/role filters (#4026 criterion 3, linuxfoundation/lfx-v2-mailing-list-service#110)
    // are only meaningful while the resolved direction is auto_c_to_ml — mirrors the sync_mode
    // preserve/reset rule above: carry the list's own persisted filters forward only when staying
    // on the SAME committee, reset to unfiltered when linking to a different one, and explicitly
    // clear both to `[]` (rather than omitting them) whenever the resolved direction isn't
    // auto_c_to_ml, so stale filters don't linger after switching away from that direction.
    let committeeFilters: CommitteeMemberVotingStatus[] | undefined;
    let committeeRoleFilters: string[] | undefined;
    if (syncMode === MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST) {
      committeeFilters = explicitCommitteeFilters ?? persisted?.committeeFilters ?? [];
      committeeRoleFilters = explicitCommitteeRoleFilters ?? persisted?.committeeRoleFilters ?? [];
    } else if (committeeUid) {
      committeeFilters = [];
      committeeRoleFilters = [];
    }

    return {
      name: ml.group_name,
      public: ml.public,
      type: ml.type,
      audience_access: ml.audience_access,
      description: ml.description,
      title: ml.title,
      service_id: ml.service_uid,
      committee_uid: committeeUid,
      subject_tag: ml.subject_tag,
      writers: ml.writers,
      auditors: ml.auditors,
      sync_mode: syncMode,
      committee_filters: committeeFilters,
      committee_role_filters: committeeRoleFilters,
    };
  }

  // See associatedMailingLists' doc comment above for the pending-row invariant this enforces.
  private initAssociatedMailingListsWithOverrides(): Signal<GroupsIOMailingList[]> {
    return computed(() => {
      const overrides = this.associatedMlOverrides();
      if (overrides.size === 0) return this.fetchedAssociatedMailingLists();
      const fetched = this.fetchedAssociatedMailingLists();
      const patched = fetched.map((ml) => {
        const override = overrides.get(ml.uid);
        return override ? this.patchCommitteeSyncMode(ml, override.sync_mode) : ml;
      });
      const fetchedUids = new Set(fetched.map((ml) => ml.uid));
      // Any override still in the map and missing from this fetch gets replayed as its own row,
      // not just a pending add: the prune loop (see initAssociatedMailingLists) now keeps a
      // non-pending override alive through its first miss too (dealako #4899 review's two-miss
      // fallback), so during that one-miss grace window the override is still "active" and must
      // stay visible — the row only needs to disappear once the prune loop actually deletes the
      // override, which it already does by the override's second consecutive miss.
      const pendingRows = [...overrides.entries()].filter(([uid]) => !fetchedUids.has(uid)).map(([, ml]) => this.patchCommitteeSyncMode(ml, ml.sync_mode));
      return pendingRows.length > 0 ? [...patched, ...pendingRows] : patched;
    });
  }

  private initAssociatedMailingListRows(): Signal<CommitteeAssociatedMailingListRow[]> {
    return computed(() =>
      this.associatedMailingLists().map((ml) => {
        const removable = ml.writer === true;
        const syncModeSupported =
          ml.sync_mode === MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST || ml.sync_mode === MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE;

        let syncTooltip = `Preview and apply committee sync for ${ml.group_name}`;
        if (!removable) {
          syncTooltip = 'You need Manage access to this mailing list to sync it.';
        } else if (!syncModeSupported) {
          syncTooltip = `Set a sync direction for ${ml.group_name} in Mailing List Settings before syncing.`;
        }

        const removeTooltip = removable ? `Remove mailing list ${ml.group_name}` : 'You need Manage access to this mailing list to unlink it.';

        return { ...ml, removable, syncModeSupported, syncTooltip, removeTooltip };
      })
    );
  }

  private initAssociatedMailingLists(): Signal<GroupsIOMailingList[]> {
    const committee$ = toObservable(this.committee);
    const refresh$ = this.refreshMl$.pipe(map(() => this.committee()));
    // Preserve the last successfully-loaded list on a failed refresh instead of wiping it to [] —
    // a transient fetch error (e.g. a flaky refreshMl$ re-fetch) would otherwise make every open
    // Auto Sync drawer card vanish rather than just leaving the data stale (#4899 review). Keyed by
    // committee uid, not a bare array: this component instance is reused across /groups/:id ->
    // /groups/:id2 navigation, so a failed fetch for committee B must not resurface committee A's
    // lists — the fallback is only valid when it matches the committee currently being requested
    // (#4899 review). A class field (lastGoodAssociatedLists), not a closure-local, so an unlink
    // path (removeMailingList, saveMailingListAssociation) can prune it directly — see
    // pruneLastGoodAssociatedList's doc comment.

    return toSignal(
      merge(committee$, refresh$).pipe(
        filter((c) => !!c?.uid),
        switchMap((c) => {
          this.mlLoadingInternal.set(true);
          return this.mailingListService.getMailingListsByCommittee(c!.uid).pipe(
            // The read model stores sync_mode/filters per-entry inside ml.committees[], not as a
            // top-level field — resolve this committee's entry onto `sync_mode` here, once, so every
            // downstream consumer of this signal (the template, the override reconciliation below,
            // the Auto Sync drawer's children) can keep reading `ml.sync_mode` directly instead of
            // re-deriving it, and an already-enabled list doesn't appear off (#4899 review).
            map((lists) => lists.map((ml) => ({ ...ml, sync_mode: getMailingListCommitteeSync(ml, c!.uid).syncMode }))),
            finalize(() => this.mlLoadingInternal.set(false)),
            // Clear refreshingMl only on an actual emission, not in finalize() — finalize() also
            // fires on unsubscribe, so a switchMap cancelling this request in favor of a newer one
            // (another refreshMl$/committee() emission) would otherwise unlock sibling cards while
            // the replacement request is still in flight (#4899 review).
            tap((lists) => {
              this.refreshingMl.set(false);
              this.mlRefreshFailed.set(false);
              const fetchedUids = new Set(lists.map((l) => l.uid));
              // Confirm absence: once this committee's refetch no longer contains a uid suppressed
              // by suppressUnlinkedMl() after a successful unlink, stop suppressing it — see
              // unlinkedMlUids' doc comment (#4899 review).
              const suppressed = this.unlinkedMlUids();
              if (suppressed.size > 0) {
                const stillStale = new Set([...suppressed].filter((uid) => fetchedUids.has(uid)));
                if (stillStale.size !== suppressed.size) {
                  this.unlinkedMlUids.set(stillStale);
                }
              }
              // Drop any override whose value the real fetch now confirms — once the query index
              // catches up, the override would otherwise keep masking a further legitimate change
              // to the same list made outside this component (#4899 review).
              const overrides = this.associatedMlOverrides();
              const pendingAdds = this.pendingAddMlUids();
              if (overrides.size > 0) {
                const next = new Map(overrides);
                for (const ml of lists) {
                  const override = next.get(ml.uid);
                  if (override && override.sync_mode === ml.sync_mode) {
                    next.delete(ml.uid);
                  }
                }
                // A non-add override (a config-only change) whose uid this successful fetch doesn't
                // return at all means the list was unlinked outside this component — keeping it would
                // let it resurrect via associatedMailingLists' pendingRows. A genuinely pending add is
                // exempt: its uid is expected to be briefly missing until the query index catches up
                // (dealako #4899 review). Pruning only happens on a uid's SECOND consecutive miss, not
                // its first — absent a confirmable guarantee that this fetch can't transiently omit a
                // still-linked list (e.g. delete+reindex semantics on a sync_mode-only PUT), one miss
                // alone isn't proof of an external unlink (dealako #4899 review).
                const missCounts = new Map(this.overrideMissCounts());
                let missCountsChanged = false;
                for (const uid of next.keys()) {
                  if (pendingAdds.has(uid)) {
                    continue;
                  }
                  if (fetchedUids.has(uid)) {
                    if (missCounts.delete(uid)) {
                      missCountsChanged = true;
                    }
                    continue;
                  }
                  const misses = (missCounts.get(uid) ?? 0) + 1;
                  if (misses >= 2) {
                    next.delete(uid);
                    missCounts.delete(uid);
                  } else {
                    missCounts.set(uid, misses);
                  }
                  missCountsChanged = true;
                }
                // Drop any miss count no longer backed by a tracked override (confirmed above, or
                // pruned on this pass) so a stale count can't resurface against a later re-add.
                for (const uid of missCounts.keys()) {
                  if (!next.has(uid)) {
                    missCounts.delete(uid);
                    missCountsChanged = true;
                  }
                }
                if (missCountsChanged) {
                  this.overrideMissCounts.set(missCounts);
                }
                if (next.size !== overrides.size) {
                  this.associatedMlOverrides.set(next);
                }
              }
              // Lift the pending-add marking the first time a fetch contains the uid at all, matching
              // or not — from that point the row comes from the `patched` branch above, not
              // `pendingRows`, so the marking no longer does anything useful and must not survive a
              // later external unlink of the same uid (dealako #4899 review).
              if (pendingAdds.size > 0) {
                const stillPending = new Set([...pendingAdds].filter((uid) => !fetchedUids.has(uid)));
                if (stillPending.size !== pendingAdds.size) {
                  this.pendingAddMlUids.set(stillPending);
                }
              }
            }),
            // Drop any row still suppressed post-unlink (#4899 review — see unlinkedMlUids' doc
            // comment). Applied after the tap above so a just-confirmed absence isn't re-filtered
            // here, and stored as the last-good snapshot so a subsequent failed refresh's fallback
            // doesn't resurrect a suppressed row either.
            map((lists) => {
              const suppressed = this.unlinkedMlUids();
              const filtered = suppressed.size === 0 ? lists : lists.filter((ml) => !suppressed.has(ml.uid));
              this.lastGoodAssociatedLists = { uid: c!.uid, lists: filtered };
              this.fetchedAssociatedListsCommitteeUid.set(c!.uid);
              return filtered;
            }),
            catchError((error) => {
              console.error('Failed to refresh associated mailing lists', error);
              // Leave refreshingMl locked rather than unlocking sibling cards against this stale
              // fallback — it only clears again once a refresh actually succeeds (#4899 review).
              // Set unconditionally (not just left alone) so a failure on a committee-input-driven
              // refresh — which never flipped refreshingMl true to begin with, unlike the
              // onSyncSettingsUpdated/retryMlRefresh/removeMailingList/saveMailingListAssociation
              // paths — still locks the drawer's sync controls (which gate on refreshingMl, not
              // mlRefreshFailed; see the template's lockedBySibling binding) instead of leaving them
              // enabled against stale or empty data (#4899 review).
              this.refreshingMl.set(true);
              // mlRefreshFailed surfaces a retry affordance instead of leaving the drawer locked
              // with no way out (#4899 review).
              this.mlRefreshFailed.set(true);
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to refresh mailing lists' });
              return of(this.lastGoodAssociatedLists?.uid === c!.uid ? this.lastGoodAssociatedLists.lists : []);
            })
          );
        })
      ),
      { initialValue: [] as GroupsIOMailingList[] }
    );
  }

  private initProjectMailingLists(): Signal<GroupsIOMailingList[]> {
    // Also refreshes on refreshProjectMl$ (association changes: link/unlink/picker direction) so the
    // snapshot reflects server state after those saves. A drawer sync-only save does NOT refetch
    // here; projectMailingLists' overlay keeps sync_mode current instead.
    // Same keyed last-good-data fallback as initAssociatedMailingLists() above — a transient fetch
    // error otherwise empties the Add List picker instead of just leaving it stale (#4899 review).
    let lastGoodProjectLists: { uid: string; lists: GroupsIOMailingList[] } | null = null;

    return toSignal(
      merge(toObservable(this.committee), this.refreshProjectMl$.pipe(map(() => this.committee()))).pipe(
        filter((c) => !!c?.project_uid),
        switchMap((c) => {
          return this.mailingListService.getMailingListsByProject(c!.project_uid!).pipe(
            // Same per-committee resolution as initAssociatedMailingLists() above — a project-wide
            // list can be linked to this committee among others, and the top-level `sync_mode` field
            // is not reliable on reads (#4899 review).
            map((lists) => lists.map((ml) => ({ ...ml, sync_mode: getMailingListCommitteeSync(ml, c!.uid).syncMode }))),
            tap((lists) => (lastGoodProjectLists = { uid: c!.project_uid!, lists })),
            catchError((error) => {
              console.error('Failed to refresh project mailing lists', error);
              return of(lastGoodProjectLists?.uid === c!.project_uid ? lastGoodProjectLists.lists : []);
            })
          );
        })
      ),
      { initialValue: [] as GroupsIOMailingList[] }
    );
  }
}
