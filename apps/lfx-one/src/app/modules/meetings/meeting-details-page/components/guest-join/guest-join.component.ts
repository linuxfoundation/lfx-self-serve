// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, ElementRef, inject, input, PLATFORM_ID, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MeetingJoinUrlState } from '@lfx-one/shared/interfaces';
import { buildJoinUrlWithParams } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { combineLatest, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingJoinUrlService } from '../../meeting-join-url.service';

/**
 * The V2 guest join form (E2-06, #2882, FR-025): name, email and organization, then Join.
 * @description It is the `guest-join` kind's form, for an anonymous visitor inside the join window,
 * and V1's escape hatch for a signed-in viewer whose account email is not on the invite list. It
 * keeps V1's behaviour: no verification or captcha; the link is fetched with the typed email once
 * the fields are valid; Join stays disabled until it resolves; the name and organization become the
 * Zoom display name (`buildJoinUrlWithParams`). On a restricted meeting the server matches the email
 * against the registrants, and a `NOT_REGISTERED_FOR_MEETING` answer says so: editing the email
 * fetches again. Nothing here auto-joins.
 *
 * Its own V2 component rather than V1's `lfx-guest-form`, which hard-codes V1's testids and styling:
 * the testid contract keeps V2's names apart from V1's.
 */
@Component({
  selector: 'lfx-meeting-guest-join',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './guest-join.component.html',
})
export class MeetingGuestJoinComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly joinUrlService = inject(MeetingJoinUrlService);
  private readonly userService = inject(UserService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef: ElementRef<HTMLElement> = inject(ElementRef);

  /**
   * Moves focus to the first field once rendered: set where the form opens in place of the control
   * that revealed it (the different-email path), so keyboard and screen-reader users land in it.
   */
  public readonly focusOnOpen = input(false);

  /**
   * The rail's primary button on `lfx-button`, as Join's: a 42px pill on the accent.
   * Arbitrary px values because the app's 14px root would shrink rem-based utilities.
   */
  protected readonly buttonClass =
    '!h-[42px] !w-full !justify-center !gap-[9px] !rounded-full !border-[var(--md-accent)] !bg-[var(--md-accent)] !text-[15px] !font-bold !text-[var(--md-surface-card)] focus-visible:!shadow-[var(--md-shadow-focus)]';

  /** V1's fields and rules; the name starts from a signed-in viewer's, as V1's does. */
  protected readonly form = new FormGroup({
    name: new FormControl<string>(this.userService.user()?.name ?? '', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    organization: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly linkState: Signal<MeetingJoinUrlState> = this.initLinkState();
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  /** The link with the typed name and organization as the Zoom display name, once it resolves. */
  protected readonly joinState: Signal<MeetingJoinUrlState> = this.initJoinState();
  protected readonly notRegistered = computed(() => this.joinState().code === 'NOT_REGISTERED_FOR_MEETING');
  /** A typed email that is not a valid address yet: Join stays disabled, and the hint says why. */
  protected readonly emailInvalid = computed(() => {
    this.formValue();
    const email = this.form.controls.email;
    return !!email.value.trim() && email.invalid;
  });
  /** What describes the email field: the mismatch answer, else the invalid-address hint. */
  protected readonly emailDescribedBy = computed(() => {
    if (this.notRegistered()) {
      return 'meeting-guest-join-error';
    }
    return this.emailInvalid() ? 'meeting-guest-join-email-hint' : null;
  });

  public constructor() {
    afterNextRender(() => {
      if (this.focusOnOpen()) {
        this.elementRef.nativeElement.querySelector<HTMLInputElement>('#meeting-guest-join-name')?.focus();
      }
    });
  }

  private initLinkState(): Signal<MeetingJoinUrlState> {
    const idle: MeetingJoinUrlState = { status: 'idle' };
    if (!isPlatformBrowser(this.platformId)) {
      return computed(() => idle);
    }
    const meetingKey = toObservable(computed(() => ({ id: this.state.meeting()?.id, password: this.state.meeting()?.password ?? null }))).pipe(
      distinctUntilChanged((a, b) => a.id === b.id && a.password === b.password)
    );
    // Debounced as V1's form is, and keyed on the email alone: the name and organization only change
    // the display-name params, so typing them never refetches.
    const email = this.form.statusChanges.pipe(
      startWith(this.form.status),
      debounceTime(300),
      map(() => (this.form.valid ? this.form.controls.email.value.trim() : null)),
      distinctUntilChanged()
    );
    return toSignal(
      combineLatest([meetingKey, email]).pipe(
        switchMap(([meeting, guestEmail]) => (meeting.id && guestEmail ? this.joinUrlService.fetch(meeting.id, meeting.password, guestEmail) : of(idle)))
      ),
      { initialValue: idle }
    );
  }

  private initJoinState(): Signal<MeetingJoinUrlState> {
    return computed(() => {
      const link = this.linkState();
      const value = this.formValue();
      if (link.status !== 'ready' || !link.url) {
        return link;
      }
      // A field edited back to invalid since the fetch: hold Join until the form is valid again.
      if (value && this.form.invalid) {
        return { status: 'idle' };
      }
      return { status: 'ready', url: buildJoinUrlWithParams(link.url, null, { name: value.name?.trim(), organization: value.organization?.trim() }) };
    });
  }
}
