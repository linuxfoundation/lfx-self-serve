// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipAdminTermOption } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeclineByTermDialogComponent } from './decline-by-term-dialog.component';

describe('DeclineByTermDialogComponent', () => {
  const fall: MentorshipAdminTermOption = { id: 'trm_fall26', name: 'Fall 2026', status: 'open' };
  const winter: MentorshipAdminTermOption = { id: 'trm_winter27', name: 'Winter 2027', status: 'open' };

  let fixture: ComponentFixture<DeclineByTermDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  const build = (terms: MentorshipAdminTermOption[] | undefined): void => {
    close = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DeclineByTermDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: terms ? { terms } : undefined } },
      ],
    });

    fixture = TestBed.createComponent(DeclineByTermDialogComponent);
    fixture.detectChanges();
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string): Element | null => element().querySelector(`[data-testid="${id}"]`);

  describe('with several open terms', () => {
    beforeEach(() => build([fall, winter]));

    it('offers every term and picks none', () => {
      expect(fixture.componentInstance['termOptions']).toEqual([
        { label: 'Fall 2026', value: 'trm_fall26' },
        { label: 'Winter 2027', value: 'trm_winter27' },
      ]);
      expect(fixture.componentInstance['form'].controls.term.value).toBeNull();
      expect(byTestId('mentorship-admin-decline-by-term-continue')).not.toBeNull();
      expect(byTestId('mentorship-admin-decline-by-term-empty')).toBeNull();
    });

    it('stays open until a term is picked', () => {
      fixture.componentInstance['onContinue']();

      expect(close).not.toHaveBeenCalled();
      expect(fixture.componentInstance['form'].controls.term.touched).toBe(true);
    });

    it('closes with the picked term', () => {
      fixture.componentInstance['form'].controls.term.setValue('trm_winter27');
      fixture.componentInstance['onContinue']();

      expect(close).toHaveBeenCalledWith(winter);
    });

    it('closes with no value when cancelled', () => {
      fixture.componentInstance['form'].controls.term.setValue('trm_fall26');
      fixture.componentInstance['onCancel']();

      expect(close).toHaveBeenCalledWith();
    });
  });

  it('picks the only open term for the admin', () => {
    build([fall]);
    fixture.componentInstance['onContinue']();

    expect(close).toHaveBeenCalledWith(fall);
  });

  it('shows the empty state without Continue when no term is open', () => {
    build([]);

    expect(byTestId('mentorship-admin-decline-by-term-empty')?.textContent?.trim()).not.toBe('');
    expect(byTestId('mentorship-admin-decline-by-term-continue')).toBeNull();
    expect(byTestId('mentorship-admin-decline-by-term-cancel')).not.toBeNull();
    expect(element().querySelector('[data-test="mentorship-admin-decline-by-term-select"]')).toBeNull();
  });

  it('treats missing dialog data as no open terms', () => {
    build(undefined);

    expect(byTestId('mentorship-admin-decline-by-term-empty')).not.toBeNull();
  });
});
