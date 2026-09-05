// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import {
  AttendanceReconciliationResult,
  AttendanceReconciliationTab,
  FilterPillOption,
  ITXUpdatePastMeetingParticipantRequest,
} from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, of, skip, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-attendance-reconciliation-drawer',
  imports: [DrawerModule, ButtonComponent, CardComponent, CardTabsBarComponent, AvatarComponent, InputTextComponent],
  templateUrl: './attendance-reconciliation-drawer.component.html',
  styleUrl: './attendance-reconciliation-drawer.component.scss',
})
export class AttendanceReconciliationDrawerComponent {
  // === Services ===
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  /** Composite meeting_and_occurrence_id of the past meeting being reconciled */
  public readonly pastMeetingId = input.required<string>();
  /** Emits after any row action succeeds so the parent can refresh its participant list */
  public readonly reconciliationChanged = output<void>();

  public readonly assignForm: FormGroup = this.fb.group({ email: [''], username: [''], first_name: [''], last_name: [''] });
  public visible = model<boolean>(false);

  // === Writable Signals ===
  public loading = signal(false);
  public poolDegraded = signal(false);
  public activeTab = signal<AttendanceReconciliationTab>('needs-review');
  public rowActionLoading = signal<Set<string>>(new Set());
  public assigningAttendeeId = signal<string | null>(null);
  private readonly results = signal<AttendanceReconciliationResult[]>([]);

  // === Computed Signals ===
  public readonly needsReviewResults = computed(() => this.results().filter((r) => !r.auto_applied && r.confidence !== 'low' && r.confidence !== 'none'));
  public readonly unmatchedResults = computed(() => this.results().filter((r) => !r.auto_applied && (r.confidence === 'low' || r.confidence === 'none')));
  public readonly autoMatchedResults = computed(() => this.results().filter((r) => r.auto_applied));
  public readonly visibleResults: Signal<AttendanceReconciliationResult[]> = this.initVisibleResults();
  public readonly tabOptions: Signal<FilterPillOption[]> = this.initTabOptions();

  // Lazy load reconciliation results when the drawer opens
  private readonly reconcile$ = toObservable(this.visible).pipe(
    skip(1),
    switchMap((isVisible) => {
      if (!isVisible) {
        return of(null);
      }
      this.loading.set(true);
      return this.meetingService.reconcilePastMeetingParticipants(this.pastMeetingId()).pipe(
        tap(() => this.loading.set(false)),
        catchError(() => {
          this.loading.set(false);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to run attendance reconciliation. Please try again.' });
          return of(null);
        })
      );
    }),
    tap((response) => {
      this.results.set(response?.results ?? []);
      this.poolDegraded.set(response?.pool_degraded ?? false);
      this.assigningAttendeeId.set(null);
      this.assignForm.reset();
      this.activeTab.set('needs-review');
    })
  );

  public constructor() {
    this.reconcile$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  // === Public Methods ===
  public selectTab(tabId: string): void {
    this.activeTab.set(tabId as AttendanceReconciliationTab);
  }

  public isRowLoading(attendeeId: string): boolean {
    return this.rowActionLoading().has(attendeeId);
  }

  /**
   * Attaches the AI's suggested candidate identity to the attendee record. Cannot yet clear
   * `is_unknown` upstream — that field is absent from ITXUpdatePastMeetingParticipantRequest until
   * lfx-v2-meeting-service#276 merges and deploys.
   */
  public confirmMatch(result: AttendanceReconciliationResult): void {
    const candidate = result.matched_candidate;
    if (!candidate) return;

    this.runRowAction(result.attendee_id, {
      email: candidate.email,
      username: candidate.username,
      lf_user_id: candidate.lf_user_id,
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      is_verified: true,
      is_ai_reconciled: true,
    });
  }

  public openAssign(result: AttendanceReconciliationResult): void {
    const candidate = result.matched_candidate;
    this.assignForm.reset({
      email: candidate?.email ?? '',
      first_name: candidate?.first_name ?? '',
      last_name: candidate?.last_name ?? '',
      username: candidate?.username ?? '',
    });
    this.assigningAttendeeId.set(result.attendee_id);
  }

  public cancelAssign(): void {
    this.assigningAttendeeId.set(null);
    this.assignForm.reset();
  }

  /**
   * Persists a manually-entered identity for this attendee. Reuses the item-3 update-participant
   * route already wired for real — only the upstream ITX identity-attach behavior behind it is
   * pending lfx-v2-meeting-service#276.
   */
  public submitAssign(result: AttendanceReconciliationResult): void {
    const form = this.assignForm.value;
    const email = (form.email ?? '').trim();
    if (!email) {
      this.messageService.add({ severity: 'error', summary: 'Email Required', detail: 'Enter an email to assign this attendee.' });
      return;
    }

    this.runRowAction(result.attendee_id, {
      email,
      username: (form.username ?? '').trim() || undefined,
      first_name: (form.first_name ?? '').trim() || undefined,
      last_name: (form.last_name ?? '').trim() || undefined,
      is_verified: true,
      is_ai_reconciled: false,
    });
  }

  /**
   * Marks the attendee reviewed without attaching an identity — the explicit admin decision this
   * repo's "never silently auto-tag unknown" rule requires for low/none confidence rows. Cannot yet
   * persist a true `is_unknown` flag upstream until lfx-v2-meeting-service#276 merges and deploys.
   */
  public leaveUnknown(result: AttendanceReconciliationResult): void {
    this.runRowAction(result.attendee_id, { is_verified: false, is_ai_reconciled: false });
  }

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initVisibleResults(): Signal<AttendanceReconciliationResult[]> {
    return computed(() => {
      switch (this.activeTab()) {
        case 'needs-review':
          return this.needsReviewResults();
        case 'unmatched':
          return this.unmatchedResults();
        case 'auto-matched':
          return this.autoMatchedResults();
      }
    });
  }

  private initTabOptions(): Signal<FilterPillOption[]> {
    return computed(() => [
      { id: 'needs-review', label: `Needs Review (${this.needsReviewResults().length})` },
      { id: 'unmatched', label: `Unmatched (${this.unmatchedResults().length})` },
      { id: 'auto-matched', label: `Auto-matched (${this.autoMatchedResults().length})` },
    ]);
  }

  // === Private Helpers ===
  private runRowAction(attendeeId: string, payload: ITXUpdatePastMeetingParticipantRequest): void {
    this.rowActionLoading.update((current) => new Set(current).add(attendeeId));

    this.meetingService
      .updatePastMeetingParticipant(this.pastMeetingId(), attendeeId, payload)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.rowActionLoading.update((current) => {
            const next = new Set(current);
            next.delete(attendeeId);
            return next;
          });
          this.results.update((current) => current.filter((r) => r.attendee_id !== attendeeId));
          this.assigningAttendeeId.set(null);
          this.assignForm.reset();
          this.messageService.add({ severity: 'success', summary: 'Attendee Updated', detail: 'The attendance record has been updated.' });
          this.reconciliationChanged.emit();
        },
        error: () => {
          this.rowActionLoading.update((current) => {
            const next = new Set(current);
            next.delete(attendeeId);
            return next;
          });
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update this attendee. Please try again.' });
        },
      });
  }
}
