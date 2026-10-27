// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SelectComponent } from '@components/select/select.component';
import { NpsBand, Survey, SurveyReminderDialogData, SurveyResponseItem, SurveySentEmailDialogData } from '@lfx-one/shared/interfaces';
import {
  buildSurveyFollowUpMailto,
  buildSurveyResponsesCsvRows,
  downloadCsv,
  getNpsBand,
  getResponseComment,
  getResponseDeliveryTimestamp,
  hasSurveyResponse,
  isSurveyOpenForFollowUp,
  localDateStamp,
} from '@lfx-one/shared/utils';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime, distinctUntilChanged, map, startWith } from 'rxjs';

import { SurveyReminderDialogComponent } from '../survey-reminder-dialog/survey-reminder-dialog.component';
import { SurveySentEmailDialogComponent } from '../survey-sent-email-dialog/survey-sent-email-dialog.component';

/**
 * Per-recipient responses for the PMO results drawer. The drawer loads every page and passes
 * the rows in, so search, filters, sort and the CSV always cover all recipients.
 */
@Component({
  selector: 'lfx-survey-responses-list',
  imports: [DatePipe, ReactiveFormsModule, ButtonComponent, InputTextComponent, MenuComponent, SelectComponent, TooltipModule],
  providers: [DialogService],
  templateUrl: './survey-responses-list.component.html',
  styleUrl: './survey-responses-list.component.scss',
})
export class SurveyResponsesListComponent {
  // === Services ===
  private readonly clipboardShareService = inject(ClipboardShareService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  /** Parent survey — supplies header counts and committee/project labels for grouping. */
  public readonly survey = input<Survey | null>(null);
  /** Every per-recipient response row (all pages). */
  public readonly responses = input<SurveyResponseItem[]>([]);
  public readonly loading = input<boolean>(false);
  /** True when the rows could not all be loaded; the list is then incomplete. */
  public readonly loadError = input<boolean>(false);
  /** Active project: reminders are offered only for its committees (the server refuses any other). */
  public readonly projectUid = input<string | null>(null);

  // === Outputs ===
  /** Emitted after reminders were sent, so the parent can reload the rows. */
  public readonly remindersSent = output<void>();

  // === Constants ===
  protected readonly npsOptions = [
    { label: 'All', value: 'all' },
    { label: 'Promoters (9-10)', value: 'promoter' },
    { label: 'Passives (7-8)', value: 'passive' },
    { label: 'Detractors (0-6)', value: 'detractor' },
  ];
  protected readonly commentOptions = [
    { label: 'All', value: 'all' },
    { label: 'With comment', value: 'with' },
    { label: 'Without comment', value: 'without' },
  ];
  protected readonly deliveryOptions = [
    { label: 'All', value: 'all' },
    { label: 'Responded', value: 'responded' },
    { label: 'Clicked', value: 'clicked' },
    { label: 'Opened', value: 'opened' },
    { label: 'Delivered', value: 'delivered' },
    { label: 'Failed', value: 'failed' },
    { label: 'Pending', value: 'pending' },
  ];

  // === Forms ===
  public filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    nps: new FormControl<string>('all', { nonNullable: true }),
    comment: new FormControl<string>('all', { nonNullable: true }),
    delivery: new FormControl<string>('all', { nonNullable: true }),
  });

  // === Writable Signals ===
  protected readonly rowActionMenuItems = signal<MenuItem[]>([]);
  protected readonly rowActionMenuOpen = signal<boolean>(false);
  protected readonly rowActionMenuResponseId = signal<string | null>(null);
  private readonly sortField = signal<string>('');
  private readonly sortDir = signal<number>(1);
  private readonly collapsedGroups = signal<Set<string>>(new Set<string>());

  // === Filter Signals ===
  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  private readonly npsFilter: Signal<string> = this.toControlSignal('nps');
  private readonly commentFilter: Signal<string> = this.toControlSignal('comment');
  private readonly deliveryFilter: Signal<string> = this.toControlSignal('delivery');

  // === Computed Signals ===
  protected readonly filteredResponses: Signal<SurveyResponseItem[]> = this.initFilteredResponses();
  protected readonly groups: Signal<{ key: string; label: string; count: number; items: SurveyResponseItem[] }[]> = this.initGroups();
  protected readonly respondedCount: Signal<number> = this.initRespondedCount();
  protected readonly totalRecipients: Signal<number> = this.initTotalRecipients();
  /** Prefilled follow-up email per recipient, built once per data change rather than per change-detection pass. */
  protected readonly mailtoById: Signal<Map<string, string>> = computed(() => {
    const survey = this.survey();
    return new Map(this.responses().map((r) => [r.id, (survey && buildSurveyFollowUpMailto(survey, r)) || `mailto:${encodeURIComponent(r.email ?? '')}`]));
  });
  /** Reminders only go out while the survey accepts responses. */
  protected readonly canRemind: Signal<boolean> = computed(() => {
    const survey = this.survey();
    return !!survey && isSurveyOpenForFollowUp(survey);
  });
  /** Committees of the active project on this survey. */
  private readonly projectCommitteeUids: Signal<Set<string>> = computed(() => {
    const projectUid = this.projectUid();
    return new Set((this.survey()?.committees ?? []).filter((c) => !!projectUid && c.project_uid === projectUid).map((c) => c.committee_uid));
  });
  protected readonly nonRespondents: Signal<SurveyResponseItem[]> = computed(() =>
    this.responses().filter((r) => !hasSurveyResponse(r) && this.projectCommitteeUids().has(r.committee_uid ?? ''))
  );
  protected readonly isFiltered: Signal<boolean> = computed(
    () => this.searchTerm() !== '' || this.npsFilter() !== 'all' || this.commentFilter() !== 'all' || this.deliveryFilter() !== 'all'
  );

  // === Protected Methods ===
  /** Opens the row "More" menu, rebuilt for the clicked recipient. */
  protected toggleRowActionMenu(event: Event, item: SurveyResponseItem, menu: MenuComponent): void {
    event.stopPropagation();
    this.rowActionMenuResponseId.set(item.id);
    const survey = this.survey();
    const items: MenuItem[] = [];
    if (this.canRemind() && !hasSurveyResponse(item) && this.projectCommitteeUids().has(item.committee_uid ?? '')) {
      items.push({ label: 'Send reminder', icon: 'fa-light fa-paper-plane', command: () => this.openReminderDialog([item]) });
    }
    if (item.survey_link) {
      items.push({
        label: 'Copy personal link',
        icon: 'fa-light fa-link',
        command: () => this.clipboardShareService.copyLink(item.survey_link ?? '', 'Personal survey link copied.'),
      });
    }
    const mailto = item.email ? this.mailtoById().get(item.id) : undefined;
    if (mailto) {
      items.push({
        label: 'Email recipient',
        icon: 'fa-light fa-envelope',
        url: mailto,
        tooltipOptions: { tooltipLabel: 'Opens your mail app with a reminder that includes their personal link', tooltipPosition: 'left' },
      });
    }
    if (survey?.email_body) {
      items.push({ label: 'View sent email', icon: 'fa-light fa-eye', command: () => this.openSentEmail(survey, item) });
    }
    this.rowActionMenuItems.set(items);
    menu.toggle(event);
  }

  /** Opens the reminder dialog for the given non-respondents (all of them from the header button). */
  protected openReminderDialog(recipients: SurveyResponseItem[] = this.nonRespondents()): void {
    const survey = this.survey();
    if (!survey || recipients.length === 0) return;
    const data: SurveyReminderDialogData = { survey, recipients };
    this.dialogService
      .open(SurveyReminderDialogComponent, {
        header: 'Send survey reminder',
        width: 'min(960px, 96vw)',
        modal: true,
        closable: true,
        draggable: false,
        data,
      })
      ?.onClose.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((sent) => {
        if (sent === true) this.remindersSent.emit();
      });
  }

  protected exportCsv(): void {
    const survey = this.survey();
    if (!survey) return;
    const slug =
      survey.survey_title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'survey';
    downloadCsv(`${slug}-responses-${localDateStamp()}.csv`, buildSurveyResponsesCsvRows(survey, this.responses()));
  }

  protected isGroupCollapsed(key: string): boolean {
    return this.collapsedGroups().has(key);
  }

  protected toggleGroup(key: string): void {
    this.collapsedGroups.update((set) => {
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  protected onSort(field: string): void {
    if (this.sortField() === field) {
      this.sortDir.update((d) => d * -1);
    } else {
      this.sortField.set(field);
      this.sortDir.set(1);
    }
  }

  protected sortIcon(field: string): string {
    if (this.sortField() !== field) {
      return 'fa-light fa-arrow-up-arrow-down text-slate-300';
    }
    return this.sortDir() === 1 ? 'fa-light fa-arrow-up-short-wide text-slate-600' : 'fa-light fa-arrow-down-wide-short text-slate-600';
  }

  protected recipientName(item: SurveyResponseItem): string {
    const name = `${item.first_name ?? ''} ${item.last_name ?? ''}`.trim();
    return name || item.username || item.email || 'Unknown recipient';
  }

  protected deliveryTimestamp(item: SurveyResponseItem): string | null {
    return getResponseDeliveryTimestamp(item);
  }

  protected comment(item: SurveyResponseItem): string | null {
    return getResponseComment(item);
  }

  protected npsBandClass(value: number | null | undefined): string {
    const band: NpsBand | null = getNpsBand(value);
    if (band === 'promoter') return 'text-green-700';
    if (band === 'passive') return 'text-yellow-700';
    if (band === 'detractor') return 'text-red-700';
    return 'text-slate-400';
  }

  // === Private Initializers ===
  private initSearchTerm(): Signal<string> {
    const control = this.filterForm.controls.search;
    return toSignal(
      control.valueChanges.pipe(
        startWith(control.value),
        debounceTime(300),
        distinctUntilChanged(),
        map((value) => (value ?? '').trim().toLowerCase())
      ),
      { initialValue: '' }
    );
  }

  private toControlSignal(controlName: 'nps' | 'comment' | 'delivery'): Signal<string> {
    const control = this.filterForm.controls[controlName];
    return toSignal(control.valueChanges.pipe(startWith(control.value), distinctUntilChanged()), { initialValue: control.value });
  }

  private initFilteredResponses(): Signal<SurveyResponseItem[]> {
    return computed(() => {
      let rows = this.responses();

      const term = this.searchTerm();
      if (term) {
        rows = rows.filter(
          (r) =>
            this.recipientName(r).toLowerCase().includes(term) ||
            (r.email ?? '').toLowerCase().includes(term) ||
            (r.organization?.name ?? '').toLowerCase().includes(term)
        );
      }

      const nps = this.npsFilter();
      if (nps !== 'all') {
        rows = rows.filter((r) => !!r.response_datetime && getNpsBand(r.nps_value) === nps);
      }

      const comment = this.commentFilter();
      if (comment === 'with') {
        rows = rows.filter((r) => getResponseComment(r) !== null);
      } else if (comment === 'without') {
        rows = rows.filter((r) => getResponseComment(r) === null);
      }

      const delivery = this.deliveryFilter();
      if (delivery !== 'all') {
        rows = rows.filter((r) => (r.response_status ?? '').toLowerCase() === delivery);
      }

      return this.sortRows(rows);
    });
  }

  private initGroups(): Signal<{ key: string; label: string; count: number; items: SurveyResponseItem[] }[]> {
    return computed(() => {
      const survey = this.survey();
      const grouped = new Map<string, SurveyResponseItem[]>();

      for (const item of this.filteredResponses()) {
        const key = item.committee_uid || 'ungrouped';
        const bucket = grouped.get(key);
        if (bucket) {
          bucket.push(item);
        } else {
          grouped.set(key, [item]);
        }
      }

      return [...grouped.entries()].map(([key, items]) => {
        const committee = survey?.committees?.find((c) => c.committee_uid === key);
        const projectName = committee?.project_name || items[0]?.project?.name || '';
        const committeeName = committee?.committee_name || '';
        const label = [projectName, committeeName].filter(Boolean).join(' | ') || 'Responses';
        return { key, label, count: items.length, items };
      });
    });
  }

  private initRespondedCount(): Signal<number> {
    return computed(() => {
      const survey = this.survey();
      if (survey && typeof survey.total_responses === 'number') {
        return survey.total_responses;
      }
      return this.responses().filter((r) => !!r.response_datetime && r.response_datetime.trim() !== '').length;
    });
  }

  private initTotalRecipients(): Signal<number> {
    return computed(() => {
      const survey = this.survey();
      if (survey && typeof survey.total_recipients === 'number' && survey.total_recipients > 0) {
        return survey.total_recipients;
      }
      return this.responses().length;
    });
  }

  // === Private Helpers ===
  private sortRows(rows: SurveyResponseItem[]): SurveyResponseItem[] {
    const field = this.sortField();
    if (!field) {
      return rows;
    }
    const dir = this.sortDir();
    return [...rows].sort((a, b) => {
      const av = this.sortValue(a, field);
      const bv = this.sortValue(b, field);
      // Infinity is the sentinel for missing/non-responded values — always sort last.
      if (av === Infinity && bv === Infinity) return 0;
      if (av === Infinity) return 1;
      if (bv === Infinity) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  private sortValue(item: SurveyResponseItem, field: string): string | number {
    switch (field) {
      case 'recipient':
        return this.recipientName(item).toLowerCase();
      case 'organization':
        return (item.organization?.name ?? '').toLowerCase();
      case 'delivery':
        return (item.response_status ?? '').toLowerCase();
      case 'responseDate': {
        const ts = item.response_datetime ? new Date(item.response_datetime).getTime() : NaN;
        return isNaN(ts) ? Infinity : ts;
      }
      case 'nps':
        // Missing/non-responded scores always sort last regardless of direction.
        return typeof item.nps_value === 'number' && !!item.response_datetime ? item.nps_value : Infinity;
      case 'comment':
        return (getResponseComment(item) ?? '').toLowerCase();
      default:
        return '';
    }
  }

  private openSentEmail(survey: Survey, response: SurveyResponseItem): void {
    const data: SurveySentEmailDialogData = { survey, response };
    this.dialogService.open(SurveySentEmailDialogComponent, {
      header: 'Sent email',
      width: 'min(760px, 96vw)',
      modal: true,
      closable: true,
      draggable: false,
      data,
    });
  }
}
