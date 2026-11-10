// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  AttendanceReconciliationResult,
  AttendanceReconciliationTab,
  ITXUpdatePastMeetingParticipantRequest,
  MeetingReconcileDialogData,
  UiTabItem,
} from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { take } from 'rxjs';

import { MeetingDialogContextComponent } from '../../meeting-dialog-context/meeting-dialog-context.component';

/**
 * Reconciles a past meeting's attendees: runs the matcher on open, then confirms, assigns or leaves each one unknown.
 * @description Same requests, buckets and copy as the past meeting page's reconciliation drawer.
 */
@Component({
  selector: 'lfx-meeting-details-reconcile-dialog',
  imports: [
    ReactiveFormsModule,
    MeetingDialogContextComponent,
    UiAvatarComponent,
    UiButtonComponent,
    UiInputComponent,
    UiModalComponent,
    UiNoteComponent,
    UiSpinnerComponent,
    UiTabsComponent,
  ],
  templateUrl: './meeting-details-reconcile-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingDetailsReconcileDialogComponent {
  private readonly data = inject<MeetingReconcileDialogData>(DIALOG_DATA);
  private readonly meetingService = inject(MeetingService);
  private readonly toast = inject(UiToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly row = this.data.row;
  protected readonly assignForm: FormGroup = this.fb.group({ email: [''], username: [''], first_name: [''], last_name: [''] });

  protected readonly loading = signal(true);
  protected readonly poolDegraded = signal(false);
  protected readonly activeTab = signal<AttendanceReconciliationTab>('needs-review');
  protected readonly rowActionLoading = signal<ReadonlySet<string>>(new Set());
  protected readonly assigningAttendeeId = signal<string | null>(null);
  private readonly results = signal<AttendanceReconciliationResult[]>([]);

  private readonly needsReviewResults: Signal<AttendanceReconciliationResult[]> = computed(() =>
    this.results().filter((r) => !r.auto_applied && r.confidence !== 'low' && r.confidence !== 'none')
  );
  private readonly unmatchedResults: Signal<AttendanceReconciliationResult[]> = computed(() =>
    this.results().filter((r) => !r.auto_applied && (r.confidence === 'low' || r.confidence === 'none'))
  );
  private readonly autoMatchedResults: Signal<AttendanceReconciliationResult[]> = computed(() => this.results().filter((r) => r.auto_applied));
  protected readonly visibleResults: Signal<AttendanceReconciliationResult[]> = this.initVisibleResults();
  protected readonly tabs: Signal<UiTabItem[]> = this.initTabs();

  public constructor() {
    this.reconcile();
  }

  protected selectTab(tab: string): void {
    this.activeTab.set(tab as AttendanceReconciliationTab);
  }

  /** `is_ai_reconciled` follows the method: a degraded pool sends deterministic matches to review too. */
  protected confirmMatch(result: AttendanceReconciliationResult): void {
    const candidate = result.matched_candidate;
    if (!candidate) return;

    this.runRowAction(result.attendee_id, {
      is_attended: true,
      email: candidate.email,
      username: candidate.username,
      lf_user_id: candidate.lf_user_id,
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      is_verified: true,
      is_unknown: false,
      is_ai_reconciled: result.method === 'ai',
    });
  }

  protected openAssign(result: AttendanceReconciliationResult): void {
    const candidate = result.matched_candidate;
    this.assignForm.reset({
      email: candidate?.email ?? '',
      first_name: candidate?.first_name ?? '',
      last_name: candidate?.last_name ?? '',
      username: candidate?.username ?? '',
    });
    this.assigningAttendeeId.set(result.attendee_id);
  }

  protected cancelAssign(): void {
    this.assigningAttendeeId.set(null);
    this.assignForm.reset();
  }

  protected submitAssign(result: AttendanceReconciliationResult): void {
    const form = this.assignForm.value;
    const email = (form.email ?? '').trim();
    if (!email) {
      this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Email Required', description: 'Enter an email to assign this attendee.' });
      return;
    }

    this.runRowAction(result.attendee_id, {
      is_attended: true,
      email,
      username: (form.username ?? '').trim() || undefined,
      first_name: (form.first_name ?? '').trim() || undefined,
      last_name: (form.last_name ?? '').trim() || undefined,
      is_verified: true,
      is_unknown: false,
      is_ai_reconciled: false,
    });
  }

  /** Marks the attendee reviewed with no identity, so later runs skip it. */
  protected leaveUnknown(result: AttendanceReconciliationResult): void {
    this.runRowAction(result.attendee_id, { is_attended: true, is_verified: false, is_unknown: true, is_ai_reconciled: false });
  }

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

  private initTabs(): Signal<UiTabItem[]> {
    return computed(() => [
      { value: 'needs-review', label: 'Needs Review', count: this.needsReviewResults().length },
      { value: 'unmatched', label: 'Unmatched', count: this.unmatchedResults().length },
      { value: 'auto-matched', label: 'Auto-matched', count: this.autoMatchedResults().length },
    ]);
  }

  private reconcile(): void {
    this.meetingService
      .reconcilePastMeetingParticipants(this.data.pastMeetingId)
      // Not cut on close: the run can apply matches on the server, and the opener must still refresh.
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          this.results.set(response.results ?? []);
          this.poolDegraded.set(response.pool_degraded ?? false);
          this.loading.set(false);
          if ((response.auto_applied_count ?? 0) > 0) this.data.onChange();
        },
        error: (error: unknown) => {
          console.error('Failed to run attendance reconciliation:', error);
          this.loading.set(false);
          this.toast.show({
            variant: 'error',
            position: 'bottom-center',
            message: 'Error',
            description: 'Failed to run attendance reconciliation. Please try again.',
          });
        },
      });
  }

  private runRowAction(attendeeId: string, payload: ITXUpdatePastMeetingParticipantRequest): void {
    this.rowActionLoading.update((current) => new Set(current).add(attendeeId));

    this.meetingService
      .updatePastMeetingParticipant(this.data.pastMeetingId, attendeeId, payload)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.clearRowLoading(attendeeId);
          this.results.update((current) => current.filter((r) => r.attendee_id !== attendeeId));
          if (this.assigningAttendeeId() === attendeeId) this.cancelAssign();
          this.toast.show({
            variant: 'success',
            position: 'bottom-center',
            message: 'Attendee Updated',
            description: 'The attendance record has been updated.',
          });
          this.data.onChange();
        },
        error: (error: unknown) => {
          console.error(`Failed to update attendee ${attendeeId}:`, error);
          this.clearRowLoading(attendeeId);
          this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Error', description: 'Failed to update this attendee. Please try again.' });
        },
      });
  }

  private clearRowLoading(attendeeId: string): void {
    this.rowActionLoading.update((current) => {
      const next = new Set(current);
      next.delete(attendeeId);
      return next;
    });
  }
}
