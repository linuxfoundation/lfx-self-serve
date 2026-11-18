// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  PLATFORM_ID,
  Signal,
  signal,
  TemplateRef,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { GROUPS_HOME_UNDO_MS } from '@lfx-one/shared/constants';
import { GroupsHomeUndo, MyPendingApplication, PendingApplicationRowVm, UiFocusable, UiToastRef } from '@lfx-one/shared/interfaces';
import { getEntityCommands } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { EMPTY, Observable, pairwise, switchMap, take } from 'rxjs';

import { MeetingProjectLogoComponent } from '../../../../meetings/meetings-redesign/components/meeting-project-logo/meeting-project-logo.component';
import { MeetingsHomeResizeService } from '../../../../meetings/meetings-redesign/services/meetings-home-resize.service';
import { GroupsHomeStore } from '../../services/groups-home.store';

/**
 * Pending applications button of the Groups page header, with the number of applications, and its drawer listing them.
 * @description Withdraw takes an application back at once and offers Undo, which applies again and reopens the same
 * application. Hidden when nothing is pending; the drawer closes with its last application and focus moves to `fallbackFocus`.
 */
@Component({
  selector: 'lfx-group-applications',
  imports: [DatePipe, RouterLink, MeetingProjectLogoComponent, UiBadgeComponent, UiButtonComponent, UiDrawerComponent, UiTooltipDirective],
  templateUrl: './group-applications.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class GroupApplicationsComponent {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly drawerService = inject(UiDrawerService);
  private readonly toast = inject(UiToastService);
  private readonly resize = inject(MeetingsHomeResizeService);
  private readonly committeeService = inject(CommitteeService);
  private readonly store = inject(GroupsHomeStore);
  private readonly drawerTemplate = viewChild.required<TemplateRef<unknown>>('drawer');
  private readonly rowElements = viewChildren<ElementRef<HTMLElement>>('rowElement');
  private readonly names = viewChildren<ElementRef<HTMLElement>>('name');
  private readonly undoButton = viewChild('undoButton', { read: ElementRef<HTMLElement> });

  /** Takes focus when the last application is withdrawn, since the button then hides. */
  public readonly fallbackFocus = input<UiFocusable | null>(null);

  /** Applications taken back this session, by uid; Undo removes them again. */
  protected readonly withdrawn = signal<ReadonlySet<string>>(new Set());
  protected readonly drawerOpen = signal(false);
  /** Names cut off by the row width; only those get a tooltip with the full text. */
  protected readonly truncated = signal<ReadonlySet<HTMLElement>>(new Set());
  /** Undo of the last withdraw, also shown in the drawer while its toast is up. */
  protected readonly undo = signal<GroupsHomeUndo | null>(null);
  protected readonly linkState = { backLabel: 'Groups', fromMeLens: true };
  private readonly loaded: Signal<MyPendingApplication[]> = this.initLoaded();
  /** Pending applications, without withdrawn ones and groups the viewer already belongs to. */
  protected readonly rows: Signal<PendingApplicationRowVm[]> = this.initRows();
  protected readonly subtitle: Signal<string> = this.initSubtitle();

  private drawerRef: DialogRef | null = null;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  /** Application the drawer's Undo restores. */
  private undoUid: string | null = null;
  /** Undo toasts shown here; they go with the page, since their Undo restores into it. */
  private readonly undoToasts = new Set<UiToastRef>();

  public constructor() {
    this.initCloseWhenEmpty();
    this.initTruncation();
    this.destroyRef.onDestroy(() => {
      this.clearUndo();
      this.undoToasts.forEach((toast) => toast.dismiss());
      this.drawerRef?.close();
    });
  }

  protected openDrawer(): void {
    if (this.drawerRef) return;
    const ref = this.drawerService.open(this.drawerTemplate(), { width: 640, describedBy: true });
    this.drawerRef = ref;
    this.drawerOpen.set(true);
    ref.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.drawerRef = null;
      this.drawerOpen.set(false);
    });
  }

  /** The group link navigates away, so the drawer closes with it. */
  protected closeDrawer(): void {
    this.drawerRef?.close();
  }

  protected withdraw(application: MyPendingApplication): void {
    const index = this.rows().findIndex((row) => row.uid === application.uid);
    this.setWithdrawn(application.uid, true);
    this.focusRow(index);
    this.committeeService
      .withdrawApplication(application.committee_uid, application.uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.offerUndo(application),
        error: (error: HttpErrorResponse) => {
          // 404 and 409: the application is gone or already reviewed, so it stays off the list.
          if (error.status === 404 || error.status === 409) {
            this.toast.show({ variant: 'warning', message: 'Application no longer pending', description: 'It was already reviewed or removed.' });
            return;
          }
          this.setWithdrawn(application.uid, false);
          // 403: only the applicant can withdraw, so a retry cannot help.
          this.toast.show({ variant: 'error', message: "Couldn't withdraw the application", description: error.status === 403 ? undefined : 'Try again.' });
        },
      });
  }

  private initLoaded(): Signal<MyPendingApplication[]> {
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    return toSignal(browser ? this.committeeService.getMyApplications() : EMPTY, { initialValue: [] });
  }

  private initRows(): Signal<PendingApplicationRowVm[]> {
    return computed(() => {
      const withdrawn = this.withdrawn();
      const memberOf = new Set(this.store.groups().map((group) => group.uid));
      return this.loaded()
        .filter((application) => !withdrawn.has(application.uid) && !memberOf.has(application.committee_uid))
        .map((application) => ({
          ...application,
          viewCommands: getEntityCommands('groups', application.committee_uid, application.is_foundation) ?? ['/groups', application.committee_uid],
          viewQueryParams: application.project_slug ? { project: application.project_slug } : null,
        }));
    });
  }

  // Keeps the last count while the emptied drawer slides out.
  private initSubtitle(): Signal<string> {
    return linkedSignal<number, string>({
      source: () => this.rows().length,
      computation: (count, previous) => {
        if (!count && previous) return previous.value;
        return `${count} ${count === 1 ? 'application' : 'applications'} waiting for admin review`;
      },
    });
  }

  /** Withdrawing the last application closes the drawer; the opener is gone with it, so focus goes to `fallbackFocus`. */
  private initCloseWhenEmpty(): void {
    toObservable(this.rows)
      .pipe(pairwise(), takeUntilDestroyed())
      .subscribe(([previous, rows]) => {
        const ref = this.drawerRef;
        if (!ref || rows.length || !previous.length) return;
        ref.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.fallbackFocus()?.focus());
        ref.close();
      });
  }

  /** Measured on render and resize, so the tooltip is ready before the first hover. */
  private initTruncation(): void {
    toObservable(computed(() => this.names().map((ref) => ref.nativeElement)))
      .pipe(
        switchMap(
          (elements) =>
            new Observable<ReadonlySet<HTMLElement>>((subscriber) =>
              this.resize.observe(elements, () => subscriber.next(new Set(elements.filter((element) => element.scrollWidth > element.clientWidth))))
            )
        ),
        takeUntilDestroyed()
      )
      .subscribe((truncated) => this.truncated.set(truncated));
  }

  private offerUndo(application: MyPendingApplication): void {
    this.clearUndo();
    this.undoUid = application.uid;
    const run = (): void => this.undoWithdraw(application);
    const toast = this.toast.show({ message: 'Application withdrawn', duration: GROUPS_HOME_UNDO_MS, actions: [{ label: 'Undo', run }] });
    this.undoToasts.add(toast);
    this.undo.set({
      ariaLabel: `Undo withdrawing your application to ${application.committee_name}`,
      run: () => {
        toast.dismiss();
        run();
      },
    });
    this.undoTimer = setTimeout(() => this.clearUndo(application.uid), GROUPS_HOME_UNDO_MS);
  }

  /** Applying again reopens the same application with its message. */
  private undoWithdraw(application: MyPendingApplication): void {
    this.clearUndo(application.uid);
    this.committeeService.submitApplication(application.committee_uid, application.message).subscribe({
      next: () => {
        this.setWithdrawn(application.uid, false);
        this.focusRow(this.rows().findIndex((row) => row.uid === application.uid));
      },
      error: () => this.toast.show({ variant: 'error', message: "Couldn't restore the application", description: 'Apply again from the group page.' }),
    });
  }

  /** Removes the drawer's Undo, only when it belongs to `uid` if one is given; focus on it moves to the first row. */
  private clearUndo(uid?: string): void {
    if (uid !== undefined && uid !== this.undoUid) return;
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    this.undoUid = null;
    if (this.undoButton()?.nativeElement.contains(this.document.activeElement)) this.focusRow(0);
    this.undo.set(null);
  }

  /** The focused button leaves with its row, or the drawer's Undo with the restore, so focus moves to the row now at `index`. */
  private focusRow(index: number): void {
    if (!this.drawerRef || index < 0) return;
    afterNextRender(
      () => {
        const rows = this.rowElements();
        rows[Math.min(index, rows.length - 1)]?.nativeElement.querySelector('button')?.focus();
      },
      { injector: this.injector }
    );
  }

  private setWithdrawn(uid: string, withdrawn: boolean): void {
    this.withdrawn.update((uids) => {
      const next = new Set(uids);
      if (withdrawn) next.add(uid);
      else next.delete(uid);
      return next;
    });
  }
}
