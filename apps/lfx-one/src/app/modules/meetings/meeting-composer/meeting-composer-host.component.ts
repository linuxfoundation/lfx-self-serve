// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MEETING_COMPOSER_SECTIONS, MEETING_COMPOSER_TOAST_KEY, MEETING_COMPOSER_TOAST_POSITION } from '@lfx-one/shared/constants';
import type { EntityWithProject, Meeting, MeetingComposerSection, MeetingComposerToastData } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { syncEntityProjectContext, syncEntityProjectContextFallback } from '@shared/utils/entity-project-context.util';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { ToastModule } from 'primeng/toast';
import type { ToastPositionType } from 'primeng/types/toast';
import { filter, pairwise, take } from 'rxjs';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerPreviewComponent } from './meeting-composer-preview.component';
import { MeetingComposerRailComponent } from './meeting-composer-rail.component';
import { MeetingComposerService } from './meeting-composer.service';
import { QuickCreateDialogComponent } from './quick-create-dialog.component';
import { ComposerAgendaResourcesComponent } from './sections/composer-agenda-resources.component';
import { ComposerDateScheduleComponent } from './sections/composer-date-schedule.component';
import { ComposerDetailsAccessComponent } from './sections/composer-details-access.component';
import { ComposerGuestsComponent } from './sections/composer-guests.component';
import { ComposerPlatformFeaturesComponent } from './sections/composer-platform-features.component';

/**
 * Globally mounted host for the meeting composer drawer (GH-1452).
 * @description Mounted on first open via `@defer` in `app.component.html` and retained thereafter, so
 * opening the composer never unmounts the page underneath. Sections are reachable from both the rail
 * and the footer navigation; the live preview is create-mode only. Below `lg` the drawer goes full
 * width, the rail column and the preview drop out, and the rail's compact chip row takes over section
 * navigation — the preview has no narrow-viewport equivalent.
 */
@Component({
  selector: 'lfx-meeting-composer-host',
  imports: [
    NgClass,
    DrawerModule,
    MeetingComposerRailComponent,
    MeetingComposerPreviewComponent,
    ButtonComponent,
    ComposerDetailsAccessComponent,
    ComposerDateScheduleComponent,
    ComposerPlatformFeaturesComponent,
    ComposerGuestsComponent,
    ComposerAgendaResourcesComponent,
    QuickCreateDialogComponent,
    ToastModule,
    RouterLink,
  ],
  templateUrl: './meeting-composer-host.component.html',
  providers: [MeetingComposerFormService],
})
export class MeetingComposerHostComponent {
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly meetingService = inject(MeetingService);
  private readonly lensService = inject(LensService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly composer = inject(MeetingComposerService);
  protected readonly formService = inject(MeetingComposerFormService);

  protected readonly sections: readonly MeetingComposerSection[] = MEETING_COMPOSER_SECTIONS;
  protected readonly toastKey = MEETING_COMPOSER_TOAST_KEY;
  /**
   * Annotated rather than inferred, so the shared literal is checked against PrimeNG's own union.
   * @description The constant lives in `@lfx-one/shared`, which carries no PrimeNG dependency — not
   * even a peer one — so the type has to be applied here, at the only place that feeds it to `<p-toast>`.
   * A typo in the constant would otherwise reach the DOM as a silently ignored `position`.
   */
  protected readonly toastPosition: ToastPositionType = MEETING_COMPOSER_TOAST_POSITION;

  /**
   * Single mode source for the chrome, matching what the rail reads.
   * @description Taken from the form service, which is also what the rail's row locking and
   * `sectionNeedsAttention` read, so the header, footer and section rows cannot describe different modes.
   * `composer.context()` is the other candidate and is written first — `initialize()` only runs from the
   * subscription in this constructor — so a context-derived reader would lead this one by a flush on every
   * open, and would hold a different value whenever the new mode differs from the retained one. The
   * enforceable part is that nothing reads both.
   * The form service is the lagging side, and because `initialize()` is the only writer of `mode` and only
   * runs for a non-null context, it also keeps the previous mode across a close. Fixing that means
   * deriving `mode` from the context rather than writing it in `initialize()`.
   */
  protected readonly isEditMode: Signal<boolean> = this.formService.isEditMode;

  protected readonly activeIndex: Signal<number> = computed(() => this.sections.findIndex((section) => section.id === this.composer.activeSection()));
  protected readonly isLastSection: Signal<boolean> = computed(() => this.activeIndex() === this.sections.length - 1);
  /**
   * Whether the footer's Next may advance from the section on screen.
   * @description Two conditions, not one. The section in front of the organizer has to be valid,
   * and — in create mode — the one they would land on has to be inside the same window the rail
   * locks: an earlier required section can go invalid without them touching it (turning on YouTube
   * auto-upload adds a title-length rule to Details & access), and Next used to walk straight past
   * a step the rail had already greyed out.
   */
  protected readonly canProceed: Signal<boolean> = computed(() => {
    // `revision` makes this recompute on every form value/status change — FormGroup validity is not a signal.
    this.formService.revision();

    if (!this.formService.isSectionValid(this.composer.activeSection())) {
      return false;
    }

    return this.isEditMode() || this.activeIndex() + 1 <= this.formService.sectionAdvanceLimit();
  });
  /**
   * Gated on whole-form validity, which is the same rule `validateForSubmit()` applies.
   * @description It used to check only the sections flagged `required`, which let the button and the
   * submit path disagree: `platform-features` is not a required section, but its reminder controls
   * carry validators and are enabled in edit mode, so a bad reminder value left Save clickable and
   * `onSubmit()` returned silently. Anything that makes the form invalid now disables the button, and
   * `sectionNeedsAttention()` no longer skips optional sections, so the reason is still findable.
   */
  protected readonly canSubmit: Signal<boolean> = computed(() => {
    // `revision` makes this recompute on every form value/status change — FormGroup validity is not a signal.
    this.formService.revision();
    // A failed edit-mode fetch leaves a valid form full of construction defaults, which would save
    // over the stored meeting. `validateForSubmit()` refuses it too; this keeps the button honest.
    // The group-selection gate is the same contract for a case no control can express: the committee
    // is on the form and valid, but the members it stands for are buffered out of `registrantUpdates`
    // until the saved guest list arrives, so the save would store the group and invite nobody.
    return this.formService.isHydrated() && this.formService.form().valid && !this.formService.hasUnreconciledGroupSelection();
  });
  protected readonly activeSectionLabel: Signal<string> = computed(() => this.sections[this.activeIndex()]?.label ?? '');
  /** Whether any required section is flagged as blocking save, on the same rule as the rail's dots. */
  protected readonly hasAttention: Signal<boolean> = computed(() => {
    this.formService.revision();

    const visited = this.composer.visitedSections();

    return this.sections.some((section) => this.formService.sectionNeedsAttention(section, visited));
  });
  /**
   * Why the toast's Edit action can't act, or `null` when it can.
   * @description One question only: reopening while another meeting is part-way through the composer
   * would discard that draft. Permission is deliberately not asked here — see
   * {@link initEditFromToastBlockedReason}.
   */
  protected readonly editFromToastBlockedReason: Signal<string | null> = this.initEditFromToastBlockedReason();
  /**
   * The open meeting reshaped for the project-context syncs, or `null` when nothing should drive them.
   */
  private readonly meetingEntityContext: Signal<EntityWithProject | null> = this.initMeetingEntityContext();

  public constructor() {
    toObservable(this.composer.context)
      .pipe(
        filter((context) => !!context),
        takeUntilDestroyed()
      )
      .subscribe((context) => this.formService.initialize(context));

    // Losing write access while the composer is open would make submit fail upstream; close it instead
    // of evicting the user from the page underneath. `canWriteMeetings`, not `canWrite`: the latter is
    // writer-only, so a meeting coordinator — who may open this composer and whose submit upstream
    // accepts — reads as false on it throughout and would never produce the transition below anyway.
    // Only a true -> false transition counts: it starts false and reports false while the grants
    // request is unresolved, so reacting to any false would close a composer opened from a deep link
    // before access ever resolved.
    //
    // The context uid rides along because the answer is per-project, and `syncEntityProjectContext`
    // below deliberately moves the context to the meeting's own project on a context-less edit link.
    // That move re-asks the question about a different project, so a true -> false across it says
    // nothing about the grant this composer was opened under: a committee writer editing a group
    // meeting, or anyone admitted on one project and editing a meeting in another, would be shut out
    // of an edit `writerGuard` had just admitted. Only a loss within one project is a loss.
    // Read as the service's own paired signal, not recomposed here from `activeContextUid()` and
    // `canWriteMeetings()`: those two move at different times, so for one tick after a context
    // change the old project's verdict wears the new project's uid and the comparison below reads
    // a cross-project move as a revocation.
    //
    // No persona exemption rides along. `evictOnWriteAccessLoss` carries one because it fires on the
    // first false after boot, which an executive director admitted by `writerGuard`'s FGA-less fast
    // path produces without ever having been granted anything. This is a pairwise true -> false, so
    // that ED never reaches it: with no grant the signal never emits true, and there is no
    // transition. What is left is an ED whose grant demonstrably existed and is now gone — a real
    // revocation, and closing is the right answer to it. Personas shape presentation, not access
    // (docs/architecture/frontend/permission-persona-navigation-model-preread.md), so exempting one
    // here would only hold someone in a composer whose save upstream has already stopped accepting.
    toObservable(this.projectContextService.meetingWriteAccess)
      .pipe(
        pairwise(),
        filter(([before, after]) => before.contextUid === after.contextUid && before.canWrite && !after.canWrite && this.composer.isOpen()),
        takeUntilDestroyed()
      )
      .subscribe(() => this.composer.close());

    // The create picker aligns the ambient lens to the picked target with `setContextLens`, whose
    // persona bypass is meant to last one flow and self-clears on that flow's terminal Router
    // event. The meeting branch has none — it raises this overlay in place instead of navigating —
    // so the overlay's own end is what has to end the override. Unconditional because the clear
    // is a no-op when nothing set one, and because the picker is the only caller: every other
    // branch of it navigates, and that navigation has already cleared its own override by the
    // time anything gets here.
    toObservable(this.composer.isOpen)
      .pipe(
        pairwise(),
        filter(([wasOpen, isOpen]) => wasOpen && !isOpen),
        takeUntilDestroyed()
      )
      .subscribe(() => this.lensService.clearContextLens());

    // Derive the project context from the meeting being edited so a context-less edit link
    // (/project/meetings/:id/edit) lands in the meeting's project, not the cookie-restored
    // last-visited project. The route component redirects to the meetings list and opens the
    // composer over it, so nothing else on that navigation carries the meeting's project.
    // The fallback covers BFF project-enrichment failure.
    // preferEntityKind: a foundation-owned meeting can be edited under a /project/* URL, so the
    // meeting's own is_foundation (not the route prefix) picks the slot and re-points the route
    // lens kind. Opt-in — the other syncEntityProjectContext callers keep URL-prefix behavior.
    syncEntityProjectContext(this.meetingEntityContext, this.projectContextService, this.router, this.destroyRef, { preferEntityKind: true });
    syncEntityProjectContextFallback(this.meetingEntityContext, this.projectService, this.projectContextService, this.router, this.destroyRef, {
      entityKind: 'meeting',
      freshFetch: (uid) => this.meetingService.getMeetingDetail(uid, { skipCache: true }),
    });
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.composer.close();
    }
  }

  /**
   * Continues a quick create in the drawer, carrying the answers over.
   * @description Only the surface moves: both are fed by the one form service instance, and nothing
   * here touches the form, which is why every answer survives. The active section is left where the
   * open put it — a quick open never leaves the first one — so the drawer lands on Details & Access
   * with the rest still to visit.
   */
  protected onSwitchToAdvanced(): void {
    this.composer.switchToAdvanced();
  }

  protected onNext(): void {
    // The button is bound to the same signal, so this only catches a keyboard activation that
    // raced the disable — but a create walking past a locked section is exactly what it must not do.
    if (!this.canProceed()) {
      return;
    }

    const next = this.sections[this.activeIndex() + 1];
    if (next) {
      this.composer.setSection(next.id);
    }
  }

  protected onBack(): void {
    const previous = this.sections[this.activeIndex() - 1];
    if (previous) {
      this.composer.setSection(previous.id);
    }
  }

  /** Jumps to the section that owns the title field. */
  protected onGoToTitleSection(): void {
    this.composer.setSection('details-access');
  }

  protected onSubmit(): void {
    if (this.formService.submitting() || !this.formService.validateForSubmit()) {
      return;
    }

    const wasEditMode = this.formService.isEditMode();

    // `submit()` completes without emitting when the save outlived its open, so reaching here always
    // means the current open is the one that was saved. `take(1)` because the stream is single-shot and
    // this handler closes the composer: nothing downstream should ever run twice.
    this.formService
      .submit()
      .pipe(take(1))
      .subscribe((meeting) => {
        if (wasEditMode) {
          this.messageService.add({ severity: 'success', summary: 'Meeting updated', detail: 'Your changes have been saved.' });
        } else {
          this.announceCreatedMeeting(meeting);
        }

        this.composer.notifySaved();
        this.composer.close();
      });
  }

  /**
   * Reopens the composer on the meeting the toast was raised for.
   * @description Guarded by `editFromToastBlockedReason`, which the template also reflects as
   * `aria-disabled` plus a tooltip naming the reason.
   */
  protected onEditCreatedMeeting(data: MeetingComposerToastData): void {
    if (this.editFromToastBlockedReason()) {
      return;
    }

    this.messageService.clear(this.toastKey);
    this.composer.open({ mode: 'edit', meetingUid: data.meetingUid });
  }

  protected onDismissToast(): void {
    this.messageService.clear(this.toastKey);
  }

  /**
   * Maps the meeting being edited to the {@link EntityWithProject} shape the project-context syncs
   * consume — Meeting carries `id`, not `uid`, and pre-enrichment payloads can lack the project
   * fields entirely, so absent values map to null there.
   * @description Gated on the composer being open in edit mode, which the route-scoped page this
   * replaced got for free from its own lifetime. This host is mounted once and retained, and both
   * syncs re-apply on every NavigationEnd for as long as they live — without the gate the last
   * meeting edited would keep re-pointing the project context long after its composer closed.
   */
  private initMeetingEntityContext(): Signal<EntityWithProject | null> {
    return computed(() => {
      const meeting = this.formService.meeting();
      if (!meeting || !this.composer.isOpen() || !this.formService.isEditMode()) {
        return null;
      }

      return {
        uid: meeting.id,
        project_uid: meeting.project_uid,
        project_slug: meeting.project_slug,
        project_name: meeting.project_name,
        is_foundation: meeting.is_foundation ?? null,
      };
    });
  }

  /**
   * The one thing that can stop the toast's Edit action: a composer already open on something else.
   * @description No permission leg, deliberately. This toast only exists because a create just
   * succeeded, and `MeetingService.createMeeting` writes the caller into the meeting's `organizers`,
   * so the person looking at it holds the meeting's own organizer permission by construction. Every
   * project-level answer available here asks a different question and gets it wrong in both
   * directions: a committee writer who created a group meeting is not a project writer or meeting
   * coordinator, so the ambient signal denies them a meeting they organize, while an organizer who
   * has since switched context is judged against a project their meeting was never in. The
   * meeting-scoped check that is actually authoritative lives on the path this action opens — a
   * revoked reopen 403s and lands on the composer's own "you don't have permission" panel, which
   * says more than a disabled button with a tooltip ever did.
   */
  private initEditFromToastBlockedReason(): Signal<string | null> {
    return computed(() => (this.composer.isOpen() ? 'Close the open composer first' : null));
  }

  /**
   * Raises the post-create toast (GH-1461).
   * @description Creating no longer navigates to the saved meeting, so this toast is the only route back
   * to it. A create that returned no meeting has nothing to link to, and falls back to a plain
   * confirmation rather than a toast whose actions would dead-end.
   */
  private announceCreatedMeeting(meeting: Meeting | null): void {
    if (!meeting?.id) {
      this.messageService.add({ severity: 'success', summary: 'Meeting created', detail: 'Open it from the list to review the details.' });
      return;
    }

    const data: MeetingComposerToastData = {
      meetingUid: meeting.id,
      meetingTitle: meeting.title ?? 'Untitled meeting',
      meetingUrl: `/meetings/${meeting.id}`,
      // The join page rejects a private or restricted meeting without its password and redirects to
      // `/meetings/not-found`, which every BOARD meeting would hit since those are forced private.
      // Carried as router state rather than a query param so the password never reaches the address
      // bar, the history entry's URL, an outbound `Referer`, or a proxy log — see
      // {@link MeetingComposerToastData.meetingLinkState}. The organizer's click is always a
      // client-side navigation, which is the only journey this link is for.
      ...(meeting.password ? { meetingLinkState: { password: meeting.password } } : {}),
    };

    // Only the newest sticky toast survives. Without a lifetime nothing retires these on its own, so
    // creating several meetings in a row stacked permanent multi-line toasts up over the content the
    // organizer is still working in. Scoped to this key, so unrelated toasts are untouched.
    this.messageService.clear(this.toastKey);

    this.messageService.add({
      key: this.toastKey,
      severity: 'success',
      summary: 'Meeting created',
      detail: data.meetingTitle,
      // Sticky, not timed. The toast carries the only two routes back to the meeting now that creating
      // doesn't navigate, and a fixed lifetime put them out of reach of anyone who needs longer than a
      // few seconds to read and target them.
      sticky: true,
      // Explicit rather than relying on the PrimeNG default: with `sticky`, the close button is the only
      // way out, and it renders outside the custom-template branch — so a template refactor upstream
      // could strand an undismissable toast. Stating it keeps the intent checkable.
      closable: true,
      data,
    });
  }
}
