// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { SelectComponent } from '@components/select/select.component';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';

import { MeetingRegistrantsDisplayComponent } from '../../../components/meeting-registrants-display/meeting-registrants-display.component';
import { RegistrantFormComponent } from '../../../components/registrant-form/registrant-form.component';

/**
 * V2's own guest list for the People drawer (#3260): V1's `lfx-meeting-registrants-display`, its
 * behaviour inherited unchanged, with a template whose LinkedIn links carry a person-specific name.
 * @description The shared list's LinkedIn anchor holds only a font icon, so a screen reader announces
 * an unnamed link (`pTooltip` is a description, not a name). The shared component stays as `main` has
 * it, because V1 renders it; this template differs only on that anchor, which gets an `aria-label`
 * naming whose profile opens and a testid, its icon hidden from assistive tech.
 */
@Component({
  selector: 'lfx-meeting-v2-registrants-display',
  imports: [
    AvatarComponent,
    BadgeComponent,
    ButtonComponent,
    ConfirmDialogModule,
    TooltipModule,
    ReactiveFormsModule,
    RadioButtonComponent,
    RegistrantFormComponent,
    SelectComponent,
    NgTemplateOutlet,
    MeetingTimePipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './v2-registrants-display.component.html',
})
export class MeetingV2RegistrantsDisplayComponent extends MeetingRegistrantsDisplayComponent {}
