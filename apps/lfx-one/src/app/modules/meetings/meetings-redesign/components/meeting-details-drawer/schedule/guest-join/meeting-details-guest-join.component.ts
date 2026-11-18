// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { booleanAttribute, ChangeDetectionStrategy, Component, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NO_MEETING_JOIN_LINK } from '@lfx-one/shared/constants';
import { MeetingJoinLink } from '@lfx-one/shared/interfaces';
import { buildJoinUrlWithParams } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { catchError, combineLatest, distinctUntilChanged, map, Observable, of, startWith, switchMap, timer } from 'rxjs';

import { MeetingDetailsContext } from '../../meeting-details.context';

/**
 * "Join as a guest": name, email and organization for someone joining without their LFX account (MD-128..131).
 * @description Inside the join window a valid form fetches the join link 300ms after the last change, with the page's
 * passcode in a header; the name and organization only label the viewer in Zoom and never reach the server.
 */
@Component({
  selector: 'lfx-meeting-details-guest-join',
  imports: [ReactiveFormsModule, UiButtonComponent, UiInputComponent, UiNoteComponent],
  templateUrl: './meeting-details-guest-join.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[12px]', 'data-testid': 'meeting-details-guest-join' },
})
export class MeetingDetailsGuestJoinComponent {
  private readonly meetingService = inject(MeetingService);
  protected readonly context = inject(MeetingDetailsContext);

  /** Inside the join window. */
  public readonly joinable = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The name to start with, such as a signed-in viewer's. */
  public readonly name = input('');

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    organization: new FormControl('', { nonNullable: true }),
  });
  protected readonly link: Signal<MeetingJoinLink> = this.initLink();

  public constructor() {
    toObservable(this.name)
      .pipe(
        map((name) => name.trim()),
        takeUntilDestroyed()
      )
      .subscribe((name) => {
        if (name && !this.form.controls.name.value) this.form.controls.name.setValue(name);
      });
  }

  private initLink(): Signal<MeetingJoinLink> {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return signal(NO_MEETING_JOIN_LINK).asReadonly();
    const form$ = this.form.valueChanges.pipe(
      startWith(this.form.value),
      map(() => JSON.stringify(this.form.getRawValue())),
      distinctUntilChanged()
    );
    return toSignal(
      combineLatest([toObservable(this.joinable), form$]).pipe(
        switchMap(([joinable]) => {
          const { name, email, organization } = this.form.getRawValue();
          const meeting = this.context.meeting();
          if (!joinable || this.form.invalid) return of(NO_MEETING_JOIN_LINK);
          // An edit drops the previous link at once; the request waits 300ms for typing to settle.
          const request$ = (): Observable<MeetingJoinLink> =>
            this.meetingService.getPublicMeetingJoinUrl(meeting.id, meeting.password ?? null, { email: email.trim() }).pipe(
              map(
                (response): MeetingJoinLink =>
                  response.link
                    ? { ...NO_MEETING_JOIN_LINK, url: buildJoinUrlWithParams(response.link, null, { name: name.trim(), organization: organization.trim() }) }
                    : { ...NO_MEETING_JOIN_LINK, error: 'Join link unavailable' }
              ),
              catchError((error: HttpErrorResponse) =>
                of({ url: null, error: error?.error?.error || 'Failed to load meeting join URL. Please try again.', code: error?.error?.code ?? null })
              )
            );
          return timer(300).pipe(
            switchMap(() => request$()),
            startWith(NO_MEETING_JOIN_LINK)
          );
        })
      ),
      { initialValue: NO_MEETING_JOIN_LINK }
    );
  }
}
