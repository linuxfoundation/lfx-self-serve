// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { ClaGroupOption } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaGroupSelectComponent } from './cla-group-select.component';

/**
 * Covers the picker's search field (#1251).
 *
 * The parent's spec drives `onClaGroupSearch` directly, so nothing there exercises this field's
 * reactive control. These tests do, because the write-back on selection has to set the control
 * without that write looking like a fresh keystroke.
 */
describe('ClaGroupSelectComponent — search field', () => {
  const VENUS: ClaGroupOption = { claGroupId: 'cg-1', projectName: 'Venus test', claGroupName: 'Venus ICLA' };

  let fixture: ComponentFixture<ClaGroupSelectComponent>;
  let searched: ReturnType<typeof vi.fn>;

  /** The control behind `lfx-input-text`; typing is a `setValue`, as the wrapper does. */
  function queryControl() {
    return (fixture.componentInstance as any).searchForm.get('query');
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ClaGroupSelectComponent],
      // The shared button renders through routerLink; PrimeNG's dialog uses synthetic animations.
      providers: [provideRouter([]), provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(ClaGroupSelectComponent);
    searched = vi.fn();
    fixture.componentInstance.search.subscribe(searched);
    fixture.componentRef.setInput('options', [VENUS]);
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('emits what was typed so the results come from the server', async () => {
    queryControl().setValue('venus');

    expect(searched).toHaveBeenCalledWith('venus');
  });

  it('invalidates a confirmed choice as soon as the text changes', async () => {
    (fixture.componentInstance as any).onSelect(VENUS);
    expect((fixture.componentInstance as any).selected()).toEqual(VENUS);

    queryControl().setValue('venu');

    // Otherwise the summary and the CTA would still name a project the field no longer matches.
    expect((fixture.componentInstance as any).selected()).toBeNull();
  });

  it('does not re-search the name it writes back on selection', async () => {
    searched.mockClear();

    (fixture.componentInstance as any).onSelect(VENUS);

    expect(queryControl().value).toBe('Venus test — Venus ICLA');
    expect(searched).not.toHaveBeenCalled();
    expect((fixture.componentInstance as any).resultsOpen()).toBe(false);
  });

  it('keeps the selection after the write-back, so the next keystroke is what clears it', async () => {
    (fixture.componentInstance as any).onSelect(VENUS);

    // Guards a suppression flag that clears too late and swallows a real keystroke instead.
    queryControl().setValue('something else');

    expect(searched).toHaveBeenCalledWith('something else');
    expect((fixture.componentInstance as any).selected()).toBeNull();
  });

  it('clears the field on reopen without searching for the empty query', async () => {
    (fixture.componentInstance as any).onSelect(VENUS);
    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();

    searched.mockClear();
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(queryControl().value).toBe('');
    expect((fixture.componentInstance as any).selected()).toBeNull();
    expect(searched).not.toHaveBeenCalled();
  });
});
