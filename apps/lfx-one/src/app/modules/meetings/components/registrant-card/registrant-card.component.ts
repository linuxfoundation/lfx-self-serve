// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MeetingService } from '@app/shared/services/meeting.service';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MeetingRegistrant, MeetingRegistrantWithState } from '@lfx-one/shared/interfaces';

import { RegistrantFormComponent } from '../registrant-form/registrant-form.component';

@Component({
  selector: 'lfx-registrant-card',
  imports: [ReactiveFormsModule, BadgeComponent, ButtonComponent, CardComponent, RegistrantFormComponent],
  templateUrl: './registrant-card.component.html',
})
export class RegistrantCardComponent implements OnInit {
  private readonly meetingService = inject(MeetingService);
  // Inputs
  public registrant = input.required<MeetingRegistrantWithState>();

  // Outputs
  public readonly onValidSave = output<{ id: string; data: MeetingRegistrant }>();
  public readonly onDelete = output<string>();

  // Internal state
  public isEditing = signal<boolean>(false);
  public form: FormGroup = new FormGroup({});

  public ngOnInit(): void {
    this.buildForm();
  }

  public handleEditClick(): void {
    this.buildForm(); // Rebuild form with latest data
    this.isEditing.set(true);
  }

  public handleDeleteClick(): void {
    const registrant = this.registrant();
    this.onDelete.emit(registrant.uid || registrant.tempId || '');
  }

  public handleSaveEdit(): void {
    if (this.form.valid) {
      const registrant = this.registrant();
      const id = registrant.uid || registrant.tempId || '';

      const updatedData: MeetingRegistrant = {
        ...registrant,
        ...this.form.value,
        uid: registrant.uid,
        meeting_uid: registrant.meeting_uid,
        occurrence_id: registrant.occurrence_id,
        org_is_member: registrant.org_is_member,
        org_is_project_member: registrant.org_is_project_member,
        avatar_url: registrant.avatar_url,
        username: registrant.username,
        created_at: registrant.created_at,
        updated_at: registrant.updated_at,
      };

      this.onValidSave.emit({ id, data: updatedData });
      this.isEditing.set(false);
    }
  }

  public handleCancelEdit(): void {
    this.buildForm(); // Reset form to original values
    this.isEditing.set(false);
  }

  private buildForm(): void {
    const registrant = this.registrant();

    this.form = this.meetingService.createRegistrantFormGroup();

    this.form.patchValue({
      first_name: registrant.first_name,
      last_name: registrant.last_name,
      email: registrant.email,
      job_title: registrant.job_title,
      org_name: registrant.org_name,
      host: registrant.host,
      linkedin_profile: registrant.linkedin_profile,
    });
  }
}
