// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { environment } from '@environments/environment';
import { ID_MIGRATION_EVENTS, ID_MIGRATION_FUNNEL, ID_MIGRATION_REASONS, ID_MIGRATION_SOURCE_APP } from '@lfx-one/shared/constants';
import { DataDogRumService } from '@services/datadog-rum.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { IdMigrationModalComponent } from './id-migration-modal.component';

/**
 * Pins the analytics contract the migration funnel depends on: "Continue" must emit the
 * CONTINUE action with the selected reason (and only a non-empty comment) before it navigates,
 * while "Stay here" must stay silent. The dialog ref and RUM service are mocked so the assertions
 * are on the payloads we hand off, not on Datadog or the dialog host. Impersonation suppression is
 * pinned in datadog-rum.service.spec.ts — it is a property of the service, not of this component.
 */
describe('IdMigrationModalComponent', () => {
  const close = vi.fn();
  const addAction = vi.fn();
  let openSpy: MockInstance<typeof window.open>;
  let fixture: ComponentFixture<IdMigrationModalComponent>;
  let component: IdMigrationModalComponent;

  // `form` is protected on the component; tests reach it through a narrow cast rather than
  // driving the wrapped PrimeNG controls through the DOM, which would test the wrappers, not this.
  const formOf = (c: IdMigrationModalComponent): FormGroup => (c as unknown as { form: FormGroup }).form;

  beforeEach(async () => {
    close.mockClear();
    addAction.mockClear();
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    await TestBed.configureTestingModule({
      imports: [IdMigrationModalComponent],
      providers: [
        provideRouter([]),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DataDogRumService, useValue: { addAction } },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IdMigrationModalComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('pre-selects no reason so the funnel can tell "answered" from "skipped"', () => {
    expect(formOf(component).get('reason')?.value).toBeNull();
    expect(formOf(component).get('comment')?.value).toBe('');
  });

  it('omits an untouched reason from the CONTINUE payload', () => {
    component.continueToIndividualDashboard();

    expect(addAction).toHaveBeenCalledWith(ID_MIGRATION_EVENTS.CONTINUE, {
      funnel: ID_MIGRATION_FUNNEL,
      source_app: ID_MIGRATION_SOURCE_APP,
      reason: undefined,
      comment: undefined,
    });
  });

  it('stayHere closes with false and emits no analytics or navigation', () => {
    component.stayHere();

    expect(close).toHaveBeenCalledWith(false);
    expect(addAction).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('continue emits CONTINUE with the reason plus a trimmed comment, then opens ID in a new tab', () => {
    formOf(component).setValue({ reason: 'something_broken', comment: '  needs polish  ' });

    component.continueToIndividualDashboard();

    expect(addAction).toHaveBeenCalledWith(ID_MIGRATION_EVENTS.CONTINUE, {
      funnel: ID_MIGRATION_FUNNEL,
      source_app: ID_MIGRATION_SOURCE_APP,
      reason: 'something_broken',
      comment: 'needs polish',
    });
    expect(openSpy).toHaveBeenCalledWith(environment.urls.individualDashboard, '_blank', 'noopener,noreferrer');
    expect(close).toHaveBeenCalledWith(true);
  });

  it('omits a whitespace-only comment from the CONTINUE payload', () => {
    formOf(component).setValue({ reason: ID_MIGRATION_REASONS[0].value, comment: '   ' });

    component.continueToIndividualDashboard();

    expect(addAction).toHaveBeenCalledWith(ID_MIGRATION_EVENTS.CONTINUE, {
      funnel: ID_MIGRATION_FUNNEL,
      source_app: ID_MIGRATION_SOURCE_APP,
      reason: ID_MIGRATION_REASONS[0].value,
      comment: undefined,
    });
  });
});
