// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, Signal } from '@angular/core';
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
 * Pins the analytics contract the migration funnel depends on: "Continue" must open the new tab
 * FIRST and only then emit the CONTINUE action with the selected reason (required, so every event
 * carries one) and only a non-empty comment, while "Stay here" must stay silent. A refused popup
 * must emit nothing and leave the dialog open, so the funnel never counts a user who never left.
 * The dialog ref and RUM service are mocked so the assertions are on the payloads we hand off, not
 * on Datadog or the dialog host. Impersonation suppression is pinned in
 * datadog-rum.service.spec.ts — it is a property of the service, not of this component.
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
  const popupBlockedOf = (c: IdMigrationModalComponent): Signal<boolean> => (c as unknown as { popupBlocked: Signal<boolean> }).popupBlocked;

  beforeEach(async () => {
    close.mockClear();
    addAction.mockClear();
    // A non-null return is the success path: window.open only yields null when the popup is
    // refused, which the blocked-popup test below opts into explicitly.
    openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);

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

  it('pre-selects no reason and holds the form invalid until one is picked', () => {
    expect(formOf(component).get('reason')?.value).toBeNull();
    expect(formOf(component).get('comment')?.value).toBe('');
    // Continue is bound to form.invalid, so this is what keeps a reason-less CONTINUE off the wire.
    expect(formOf(component).invalid).toBe(true);
  });

  it('is valid on a reason alone — the comment stays optional', () => {
    formOf(component).get('reason')?.setValue(ID_MIGRATION_REASONS[0].value);

    expect(formOf(component).valid).toBe(true);
  });

  it.each(ID_MIGRATION_REASONS.map((r) => r.value))('accepts %s as a reason', (reason) => {
    formOf(component).get('reason')?.setValue(reason);

    component.continueToIndividualDashboard();

    expect(addAction).toHaveBeenCalledWith(ID_MIGRATION_EVENTS.CONTINUE, expect.objectContaining({ reason }));
  });

  it('stayHere closes with false and emits no analytics or navigation', () => {
    component.stayHere();

    expect(close).toHaveBeenCalledWith(false);
    expect(addAction).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('continue opens ID in a new tab, then emits CONTINUE with the reason plus a trimmed comment', () => {
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

  it('records nothing and stays open when the popup is blocked', () => {
    // window.open returns null when a popup blocker refuses the tab. Emitting CONTINUE here would
    // book a migration that never navigated, so the funnel's completion count would drift up.
    openSpy.mockReturnValue(null);
    formOf(component).setValue({ reason: 'missing_feature', comment: '' });

    component.continueToIndividualDashboard();

    expect(addAction).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    // Surfaces the manual fallback link so Continue does not look inert.
    expect(popupBlockedOf(component)()).toBe(true);
  });

  it('does not touch window on the server, and records no migration there', () => {
    // Guarding on PLATFORM_ID keeps SSR safe; with no tab opened there is nothing to report.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [IdMigrationModalComponent],
      providers: [
        provideRouter([]),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DataDogRumService, useValue: { addAction } },
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });
    const serverFixture = TestBed.createComponent(IdMigrationModalComponent);
    formOf(serverFixture.componentInstance).get('reason')?.setValue('other');

    serverFixture.componentInstance.continueToIndividualDashboard();

    expect(openSpy).not.toHaveBeenCalled();
    expect(addAction).not.toHaveBeenCalled();
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
