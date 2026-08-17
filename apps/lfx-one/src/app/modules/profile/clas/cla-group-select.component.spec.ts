// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { ClaGroupOption } from '@lfx-one/shared/interfaces';
import { MyClasService } from '@services/my-clas.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaGroupSelectComponent } from './cla-group-select.component';

/** Comfortably past the component's 250 ms search debounce. */
const SEARCH_SETTLE_MS = 400;

/**
 * Covers the picker opened by DialogService (#1251).
 *
 * The dialog owns its own search, so these tests drive the reactive control and assert what
 * reaches the service and what the dialog closes with — the two things the parent depends on.
 */
describe('ClaGroupSelectComponent', () => {
  const VENUS: ClaGroupOption = { claGroupId: 'cg-1', projectName: 'Venus test', claGroupName: 'Venus ICLA' };

  let fixture: ComponentFixture<ClaGroupSelectComponent>;
  let getClaGroupOptions: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  /** The control behind `lfx-input-text`; typing is a `setValue`, as the wrapper does. */
  function queryControl() {
    return (fixture.componentInstance as any).searchForm.get('query');
  }

  async function type(value: string): Promise<void> {
    queryControl().setValue(value);
    await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLE_MS));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    getClaGroupOptions = vi.fn(() => of([VENUS]));
    close = vi.fn();

    TestBed.configureTestingModule({
      imports: [ClaGroupSelectComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: MyClasService, useValue: { getClaGroupOptions } },
      ],
    });

    fixture = TestBed.createComponent(ClaGroupSelectComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('sends the typed query upstream instead of filtering a fetched list', async () => {
    await type('venus');

    // #1250 replaces the route behind this call with the real four-source search; a component
    // that filtered locally would have to change again.
    expect(getClaGroupOptions).toHaveBeenCalledWith('venus');
    expect((fixture.componentInstance as any).options()).toEqual([VENUS]);
  });

  it('coalesces keystrokes into a single query', async () => {
    queryControl().setValue('v');
    queryControl().setValue('ve');
    await type('ven');

    expect(getClaGroupOptions).toHaveBeenCalledTimes(1);
    expect(getClaGroupOptions).toHaveBeenCalledWith('ven');
  });

  it('closes with the chosen option so the caller can resolve the hand-off', async () => {
    await type('venus');

    (fixture.componentInstance as any).onSelect(VENUS);
    (fixture.componentInstance as any).onContinue();

    expect(close).toHaveBeenCalledWith(VENUS);
  });

  it('closes with null when the contributor backs out', async () => {
    (fixture.componentInstance as any).onCancel();

    expect(close).toHaveBeenCalledWith(null);
  });

  it('does not close when nothing is selected', async () => {
    await type('venus');

    (fixture.componentInstance as any).onContinue();

    expect(close).not.toHaveBeenCalled();
  });

  it('invalidates a confirmed choice as soon as the text changes', async () => {
    await type('venus');
    (fixture.componentInstance as any).onSelect(VENUS);

    await type('venu');

    // Otherwise the summary and the CTA would still name a project the field no longer matches.
    expect((fixture.componentInstance as any).selected()).toBeNull();
  });

  it('does not re-search the name it writes back on selection', async () => {
    await type('venus');
    getClaGroupOptions.mockClear();

    (fixture.componentInstance as any).onSelect(VENUS);
    await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLE_MS));

    expect(queryControl().value).toBe('Venus test — Venus ICLA');
    expect(getClaGroupOptions).not.toHaveBeenCalled();
    expect((fixture.componentInstance as any).resultsOpen()).toBe(false);
  });

  it('keeps searching after the write-back, so the next keystroke is not swallowed', async () => {
    await type('venus');
    (fixture.componentInstance as any).onSelect(VENUS);
    getClaGroupOptions.mockClear();

    // Guards a suppression flag that clears too late.
    await type('something else');

    expect(getClaGroupOptions).toHaveBeenCalledWith('something else');
    expect((fixture.componentInstance as any).selected()).toBeNull();
  });

  it('surfaces a failed search without closing the dialog', async () => {
    getClaGroupOptions.mockReturnValue(throwError(() => new Error('boom')));

    await type('venus');

    expect((fixture.componentInstance as any).error()).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('can search again after a failure', async () => {
    getClaGroupOptions.mockReturnValueOnce(throwError(() => new Error('boom')));

    await type('venus');
    // Retry re-issues the same query. A stream that dropped repeats would strand the picker on
    // its error state with no way back.
    (fixture.componentInstance as any).retry();
    await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLE_MS));
    fixture.detectChanges();

    expect((fixture.componentInstance as any).error()).toBe(false);
    expect((fixture.componentInstance as any).options()).toEqual([VENUS]);
  });
});
