// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ALREADY_SIGNED_CLA_LABEL } from '@lfx-one/shared/constants';
import type { ClaGroupOption, ClaGroupSearchResponse, MyClaAgreement } from '@lfx-one/shared/interfaces';
import { toClaGroupOptionView } from '@lfx-one/shared/utils';
import { MyClasService } from '@services/my-clas.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Tooltip } from 'primeng/tooltip';
import { of, Subject, throwError } from 'rxjs';
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
  const VENUS: ClaGroupOption = { claGroupId: 'cg-1', projectName: 'Venus test', claGroupName: 'Venus ICLA', matchTypes: ['project'], organizations: [] };
  const VENUS_VIEW = toClaGroupOptionView(VENUS);

  /** The route answers with the producer's envelope, not a bare array (#1250). */
  function envelope(results: ClaGroupOption[], overrides: Partial<ClaGroupSearchResponse> = {}): ClaGroupSearchResponse {
    return { searchTerm: 'venus', resultCount: results.length, truncated: false, results, ...overrides };
  }

  let fixture: ComponentFixture<ClaGroupSelectComponent>;
  let getClaGroupOptions: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  /** The control behind `lfx-input-text`; typing is a `setValue`, as the wrapper does. */
  function queryControl() {
    return (fixture.componentInstance as any).searchForm.get('query');
  }

  function state(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="cla-group-select-${testId}"]`);
  }

  async function type(value: string): Promise<void> {
    queryControl().setValue(value);
    await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLE_MS));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    getClaGroupOptions = vi.fn(() => of(envelope([VENUS])));
    close = vi.fn();

    TestBed.configureTestingModule({
      imports: [ClaGroupSelectComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { agreements: [] } } },
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
    expect((fixture.componentInstance as any).options()).toEqual([VENUS_VIEW]);
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

    (fixture.componentInstance as any).onSelect(VENUS_VIEW);
    (fixture.componentInstance as any).onContinue();

    expect(close).toHaveBeenCalledWith(VENUS_VIEW);
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
    (fixture.componentInstance as any).onSelect(VENUS_VIEW);

    await type('venu');

    // Otherwise the summary and the CTA would still name a project the field no longer matches.
    expect((fixture.componentInstance as any).selected()).toBeNull();
  });

  it('does not re-search the name it writes back on selection', async () => {
    await type('venus');
    getClaGroupOptions.mockClear();

    (fixture.componentInstance as any).onSelect(VENUS_VIEW);
    await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLE_MS));

    expect(queryControl().value).toBe('Venus test — Venus ICLA');
    expect(getClaGroupOptions).not.toHaveBeenCalled();
    expect((fixture.componentInstance as any).resultsOpen()).toBe(false);
  });

  it('keeps searching after the write-back, so the next keystroke is not swallowed', async () => {
    await type('venus');
    (fixture.componentInstance as any).onSelect(VENUS_VIEW);
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
    expect((fixture.componentInstance as any).options()).toEqual([VENUS_VIEW]);
  });

  it('does not search a term that is shorter than three characters once trimmed', async () => {
    await type('c');
    await type('cn');
    await type('  cn  ');

    // Upstream answers 422 below three characters (400 once trimmed) — a contributor two letters
    // into a project name has made no mistake worth showing them an error for.
    expect(getClaGroupOptions).not.toHaveBeenCalled();
  });

  it('stops searching again when the term is deleted back below three characters', async () => {
    await type('venus');
    getClaGroupOptions.mockClear();

    await type('ve');

    expect(getClaGroupOptions).not.toHaveBeenCalled();
  });

  it('does not re-issue the same producer search when the field is refocused', async () => {
    await type('venus');
    getClaGroupOptions.mockClear();

    (fixture.componentInstance as any).onFocus();
    await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLE_MS));

    expect(getClaGroupOptions).not.toHaveBeenCalled();
  });

  it('tells an empty box, a too-short term and a term that matched nothing apart', async () => {
    (fixture.componentInstance as any).onFocus();
    fixture.detectChanges();
    expect(state('empty')).not.toBeNull();
    expect(state('keep-typing')).toBeNull();
    expect(state('no-match')).toBeNull();

    await type('cn');
    expect(state('keep-typing')).not.toBeNull();
    expect(state('empty')).toBeNull();
    expect(state('no-match')).toBeNull();

    getClaGroupOptions.mockReturnValue(of(envelope([])));
    await type('nothing matches this');
    // "You have not typed yet", "keep going" and "that term found nothing" are three different
    // answers to "why is the list empty?" — collapsing them is how "my project isn't there"
    // becomes undiagnosable.
    expect(state('no-match')).not.toBeNull();
    expect(state('empty')).toBeNull();
    expect(state('keep-typing')).toBeNull();
  });

  it('hides previously shown results while the term is too short', async () => {
    await type('venus');
    expect(state('cg-1')).not.toBeNull();

    await type('ve');

    expect(state('cg-1')).toBeNull();
    expect(state('keep-typing')).not.toBeNull();
  });

  it('keeps the previous results on screen while the next search is in flight', async () => {
    await type('venus');

    const pending = new Subject<ClaGroupSearchResponse>();
    getClaGroupOptions.mockReturnValueOnce(pending);
    await type('venus test');

    // The producer's cold path is a five-table scan bounded at 15 seconds. Swapping the list for
    // a spinner on every keystroke past the third flashes the modal empty for that whole window.
    expect((fixture.componentInstance as any).loading()).toBe(true);
    expect(state('cg-1')).not.toBeNull();
    expect(state('pending')).not.toBeNull();
  });

  it('shows the spinner alone only when there is nothing yet to keep', async () => {
    const pending = new Subject<ClaGroupSearchResponse>();
    getClaGroupOptions.mockReturnValueOnce(pending);

    await type('venus');

    expect(state('loading')).not.toBeNull();
    expect(state('cg-1')).toBeNull();
  });

  it('asks for a narrower term when the producer capped the set, distinctly from no-match', async () => {
    getClaGroupOptions.mockReturnValue(of(envelope([VENUS], { truncated: true, resultCount: 20 })));

    await type('venus');

    // "There are more than we showed you" and "there are none" are opposite facts.
    expect(state('truncated')).not.toBeNull();
    expect(state('no-match')).toBeNull();
    expect(state('cg-1')).not.toBeNull();
  });

  it('does not claim truncation once a later search comes back uncapped', async () => {
    getClaGroupOptions.mockReturnValueOnce(of(envelope([VENUS], { truncated: true })));
    await type('venus');

    getClaGroupOptions.mockReturnValueOnce(of(envelope([VENUS])));
    await type('venus test');

    expect(state('truncated')).toBeNull();
  });

  it('shows one error for a leaked 400 and a leaked 422 alike', async () => {
    for (const status of [400, 422]) {
      getClaGroupOptions.mockReturnValueOnce(throwError(() => ({ status, error: { code: 604 } })));

      await type(`term ${status}`);

      // Both are the same contributor mistake — the client gate makes them unreachable anyway, so
      // per-status copy would be dead text that promises a distinction the product does not make.
      expect((fixture.componentInstance as any).error()).toBe(true);
      expect(state('error')).not.toBeNull();
      expect(state('no-match')).toBeNull();
    }
  });

  describe('keyboard', () => {
    const MARS: ClaGroupOption = { claGroupId: 'cg-2', projectName: 'Mars test', matchTypes: ['project'], organizations: [] };

    function press(key: string): void {
      (fixture.componentInstance as any).onKeydown(new KeyboardEvent('keydown', { key }));
      fixture.detectChanges();
    }

    beforeEach(async () => {
      getClaGroupOptions.mockReturnValue(of(envelope([VENUS, MARS])));
      await type('venus');
    });

    it('moves the highlight down and up through the results', () => {
      press('ArrowDown');
      expect((fixture.componentInstance as any).highlightedIndex()).toBe(0);

      press('ArrowDown');
      expect((fixture.componentInstance as any).highlightedIndex()).toBe(1);

      press('ArrowUp');
      expect((fixture.componentInstance as any).highlightedIndex()).toBe(0);
    });

    it('selects the highlighted result on Enter', () => {
      press('ArrowDown');
      press('ArrowDown');
      press('Enter');

      expect((fixture.componentInstance as any).selected()).toEqual(toClaGroupOptionView(MARS));
    });

    it('does not select on Enter when nothing is highlighted', () => {
      press('Enter');

      expect((fixture.componentInstance as any).selected()).toBeNull();
    });

    it('closes on Escape without selecting', () => {
      press('ArrowDown');
      press('Escape');

      expect(close).toHaveBeenCalledWith(null);
      expect(close).not.toHaveBeenCalledWith(VENUS);
    });

    it('drops the highlight as soon as the query changes, before the next list arrives', () => {
      press('ArrowDown');
      expect((fixture.componentInstance as any).highlightedIndex()).toBe(0);

      queryControl().setValue('venus test');
      fixture.detectChanges();

      // Enter during the debounce would otherwise confirm the previous highlight.
      expect((fixture.componentInstance as any).highlightedIndex()).toBe(-1);
    });

    it('drops the highlight when a new result set arrives, so Enter cannot pick a stale row', async () => {
      press('ArrowDown');

      getClaGroupOptions.mockReturnValue(of(envelope([MARS])));
      await type('mars test');

      // The highlighted index refers to a position in a list that no longer exists; keeping it
      // would confirm whichever project happened to land at that offset.
      expect((fixture.componentInstance as any).highlightedIndex()).toBe(-1);
    });

    it('cannot confirm a result that the keep-typing copy has already replaced', async () => {
      press('ArrowDown');
      await type('ve');
      press('Enter');

      expect((fixture.componentInstance as any).selected()).toBeNull();
      expect((fixture.componentInstance as any).options()).toEqual([]);
    });

    it('cannot confirm a result after a later search fails', async () => {
      press('ArrowDown');
      getClaGroupOptions.mockReturnValue(throwError(() => new Error('boom')));
      await type('venus test');
      press('Enter');

      expect((fixture.componentInstance as any).error()).toBe(true);
      expect((fixture.componentInstance as any).selected()).toBeNull();
      expect((fixture.componentInstance as any).options()).toEqual([]);
    });
  });

  it('never lets a slower earlier search overwrite the results of a later one', async () => {
    const MARS: ClaGroupOption = { claGroupId: 'cg-2', projectName: 'Mars test', matchTypes: ['project'], organizations: [] };
    const first = new Subject<ClaGroupSearchResponse>();
    const second = new Subject<ClaGroupSearchResponse>();
    getClaGroupOptions.mockReturnValueOnce(first).mockReturnValueOnce(second);

    await type('venus');
    await type('mars test');

    // The producer's cold path is a multi-second five-table scan, so out-of-order answers are the
    // expected case, not a rarity: `switchMap` unsubscribes the first before it can land.
    second.next(envelope([MARS], { searchTerm: 'mars test' }));
    first.next(envelope([VENUS]));
    fixture.detectChanges();

    expect((fixture.componentInstance as any).options()).toEqual([toClaGroupOptionView(MARS)]);
  });

  describe('already signed (#1914)', () => {
    const alreadyHeld: MyClaAgreement = {
      id: 's1',
      kind: 'ICLA',
      claGroupName: 'Venus ICLA',
      claGroupId: 'cg-1',
      signedOn: '2022-01-01',
      status: 'valid',
      pdfAvailable: true,
      signedVia: 'github',
      signedAs: 'jellis',
    };

    beforeEach(async () => {
      TestBed.resetTestingModule();
      getClaGroupOptions = vi.fn(() => of(envelope([VENUS])));
      close = vi.fn();

      TestBed.configureTestingModule({
        imports: [ClaGroupSelectComponent],
        providers: [
          provideRouter([]),
          provideNoopAnimations(),
          { provide: DynamicDialogRef, useValue: { close } },
          { provide: DynamicDialogConfig, useValue: { data: { agreements: [alreadyHeld] } } },
          { provide: MyClasService, useValue: { getClaGroupOptions } },
        ],
      });

      fixture = TestBed.createComponent(ClaGroupSelectComponent);
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('tags a group the contributor already holds a CLA for with the identity that signed it', async () => {
      await type('venus');

      const row = fixture.debugElement.query(By.css('[data-testid="cla-group-select-cg-1"]'));
      expect(state('already-signed-cg-1')?.textContent?.trim()).toBe(`${ALREADY_SIGNED_CLA_LABEL} as jellis (GitHub)`);
      expect(row.injector.get(Tooltip, null)?.content).toBe(
        'You already have an ICLA for this CLA group. Signed as jellis (GitHub). If you have another identity linked, you can still sign with it.'
      );
    });

    it('announces the note alongside the project name rather than in place of it', async () => {
      await type('venus');

      // An aria-label here would win over the visible text, leaving a screen reader to read
      // every tagged row as the same sentence with no way to tell the projects apart.
      const row = fixture.debugElement.query(By.css('[data-testid="cla-group-select-cg-1"]'));
      expect(row.nativeElement.getAttribute('aria-label')).toBeNull();
      expect(row.nativeElement.textContent).toContain(VENUS_VIEW.primaryName);

      const describedBy = row.nativeElement.getAttribute('aria-describedby');
      expect(describedBy).toBe('cla-group-already-signed-cg-1');
      expect(fixture.nativeElement.querySelector(`#${describedBy}`)?.textContent?.trim()).toBe(
        'You already have an ICLA for this CLA group. Signed as jellis (GitHub). If you have another identity linked, you can still sign with it.'
      );
    });

    it('still lets them select it, because another of their identities may be able to sign', async () => {
      await type('venus');

      const row = fixture.debugElement.query(By.css('[data-testid="cla-group-select-cg-1"]'));
      expect(row.nativeElement.getAttribute('aria-disabled')).toBeNull();

      (fixture.componentInstance as any).onSelect(VENUS_VIEW);
      expect((fixture.componentInstance as any).selected()).toEqual(VENUS_VIEW);
    });
  });
});
