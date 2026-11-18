// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { DatePipe, isPlatformBrowser } from '@angular/common';
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
import { MyPendingApplication, PendingApplicationRowVm, UiFocusable } from '@lfx-one/shared/interfaces';
import { getEntityCommands } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { EMPTY, pairwise, take } from 'rxjs';

import { MeetingProjectLogoComponent } from '../../../../meetings/meetings-redesign/components/meeting-project-logo/meeting-project-logo.component';
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
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly drawerService = inject(UiDrawerService);
  private readonly toast = inject(UiToastService);
  private readonly committeeService = inject(CommitteeService);
  private readonly store = inject(GroupsHomeStore);
  private readonly drawerTemplate = viewChild.required<TemplateRef<unknown>>('drawer');
  private readonly rowElements = viewChildren<ElementRef<HTMLElement>>('rowElement');

  /** Takes focus when the last application is withdrawn, since the button then hides. */
  public readonly fallbackFocus = input<UiFocusable | null>(null);

  /** Applications taken back this session, by uid; Undo removes them again. */
  protected readonly withdrawn = signal<ReadonlySet<string>>(new Set());
  protected readonly drawerOpen = signal(false);
  /** Names cut off by the row width; only those get a tooltip with the full text. */
  protected readonly truncated = signal<ReadonlySet<HTMLElement>>(new Set());
  protected readonly linkState = { backLabel: 'Groups', fromMeLens: true };
  private readonly loaded: Signal<MyPendingApplication[]> = this.initLoaded();
  /** Pending applications, without withdrawn ones and groups the viewer already belongs to. */
  protected readonly rows: Signal<PendingApplicationRowVm[]> = this.initRows();
  protected readonly subtitle: Signal<string> = this.initSubtitle();

  private drawerRef: DialogRef | null = null;

  public constructor() {
    this.initCloseWhenEmpty();
    this.destroyRef.onDestroy(() => this.drawerRef?.close());
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

  protected checkTruncated(element: HTMLElement): void {
    const cut = element.scrollWidth > element.clientWidth;
    if (cut === this.truncated().has(element)) return;
    this.truncated.update((elements) => {
      const next = new Set(elements);
      if (cut) next.add(element);
      else next.delete(element);
      return next;
    });
  }

  protected withdraw(application: MyPendingApplication): void {
    const index = this.rows().findIndex((row) => row.uid === application.uid);
    this.setWithdrawn(application.uid, true);
    if (this.drawerRef && index >= 0) {
      // The focused button leaves with its row; focus moves to the next one left.
      afterNextRender(() => this.rowElements()[Math.min(index, this.rowElements().length - 1)]?.nativeElement.querySelector('button')?.focus(), {
        injector: this.injector,
      });
    }
    this.committeeService.withdrawApplication(application.committee_uid, application.uid).subscribe({
      next: () => this.toast.show({ message: 'Application withdrawn', actions: [{ label: 'Undo', run: () => this.undoWithdraw(application) }] }),
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
        ref.closed.pipe(take(1)).subscribe(() => this.fallbackFocus()?.focus());
        ref.close();
      });
  }

  /** Applying again reopens the same application with its message. */
  private undoWithdraw(application: MyPendingApplication): void {
    this.committeeService.submitApplication(application.committee_uid, application.message).subscribe({
      next: () => this.setWithdrawn(application.uid, false),
      error: () => this.toast.show({ variant: 'error', message: "Couldn't restore the application", description: 'Apply again from the group page.' }),
    });
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
