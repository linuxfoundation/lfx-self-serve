// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { COMPOSITION_BUFFER_MODE, FormControl, ReactiveFormsModule } from '@angular/forms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiTextareaComponent } from './textarea.component';

@Component({
  selector: 'lfx-ui-textarea-test-host',
  imports: [UiTextareaComponent, ReactiveFormsModule],
  template: `<lfx-ui-textarea label="Description" [formControl]="control" />`,
})
class FormHostComponent {
  public readonly control = new FormControl('Runs the weekly sync', { nonNullable: true });
}

describe('UiTextareaComponent', () => {
  let fixture: ComponentFixture<UiTextareaComponent>;
  let host: HTMLElement;

  const field = (): HTMLTextAreaElement => host.querySelector('[data-testid="ui-textarea"]') as HTMLTextAreaElement;
  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };
  const type = async (text: string): Promise<void> => {
    field().value = text;
    field().dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiTextareaComponent, FormHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiTextareaComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('label', 'Description');
    await fixture.whenStable();
  });

  it('links the visible label to the textarea', () => {
    const label = host.querySelector('[data-testid="ui-textarea-label"]') as HTMLLabelElement;

    expect(label.htmlFor).toBe(field().id);
    expect(field().getAttribute('aria-label')).toBeNull();
  });

  it('uses ariaLabel when there is no visible label', async () => {
    await set('label', '');
    await set('ariaLabel', 'Release notes');

    expect(host.querySelector('[data-testid="ui-textarea-label"]')).toBeNull();
    expect(field().getAttribute('aria-label')).toBe('Release notes');
  });

  it('writes typed text to the value model', async () => {
    await type('Weekly sync');

    expect(fixture.componentInstance.value()).toBe('Weekly sync');
  });

  it('keeps line breaks in the value', async () => {
    await type('one\ntwo');

    expect(fixture.componentInstance.value()).toBe('one\ntwo');
  });

  it('describes the field with the hint', async () => {
    await set('hint', '280 characters left');
    const hint = host.querySelector('[data-testid="ui-textarea-hint"]') as HTMLElement;

    expect(field().getAttribute('aria-describedby')).toBe(hint.id);
    expect(field().getAttribute('aria-invalid')).toBeNull();
  });

  it('shows the error instead of the hint, marks the field invalid and describes it', async () => {
    await set('hint', '280 characters left');
    await set('error', 'Add at least one sentence.');
    const error = host.querySelector('[data-testid="ui-textarea-error"]') as HTMLElement;

    expect(host.querySelector('[data-testid="ui-textarea-hint"]')).toBeNull();
    expect(error.textContent).toContain('Add at least one sentence.');
    expect(error.getAttribute('role')).toBe('alert');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe(error.id);
  });

  it('has no describedby without a hint or error', () => {
    expect(field().hasAttribute('aria-describedby')).toBe(false);
  });

  it('forwards maxlength only for a valid limit', async () => {
    expect(field().hasAttribute('maxlength')).toBe(false);

    await set('maxlength', 280);
    expect(field().getAttribute('maxlength')).toBe('280');

    await set('maxlength', 'abc');
    expect(field().hasAttribute('maxlength')).toBe(false);
  });

  it('leaves autocomplete to the browser unless a token is set', async () => {
    expect(field().hasAttribute('autocomplete')).toBe(false);

    await set('autocomplete', 'off');

    expect(field().getAttribute('autocomplete')).toBe('off');
  });

  it('keeps a visible border and focus outline in forced-colors mode', async () => {
    expect(field().className).toContain('forced-colors:border-[color:CanvasText]');
    expect(field().className).toContain('forced-colors:focus:outline-[color:Highlight]');

    await set('disabled', true);
    expect(field().className).toContain('forced-colors:border-[color:GrayText]');
  });

  it('resizes vertically from an 80px minimum', () => {
    expect(field().className).toContain('resize-y');
    expect(field().className).toContain('min-h-[80px]');
  });

  it('gives each instance its own ids', () => {
    const other = TestBed.createComponent(UiTextareaComponent);
    other.detectChanges();

    expect((other.nativeElement as HTMLElement).querySelector('textarea')?.id).not.toBe(field().id);
  });

  it('disables the field and drops the hover ring', async () => {
    expect(field().className).toContain('edge-hover');

    await set('disabled', true);

    expect(field().disabled).toBe(true);
    expect(field().className).not.toContain('edge-hover');
  });

  it('marks required for assistive technology', async () => {
    await set('required', true);

    expect(field().required).toBe(true);
  });

  it('holds back IME composition text until composition ends', async () => {
    const seen: string[] = [];
    fixture.componentInstance.registerOnChange((v) => seen.push(v));

    field().dispatchEvent(new CompositionEvent('compositionstart'));
    await type('に');
    await type('日本');

    expect(seen).toEqual([]);
    expect(fixture.componentInstance.value()).toBe('');

    field().dispatchEvent(new CompositionEvent('compositionend'));
    await fixture.whenStable();

    expect(seen).toEqual(['日本']);
    expect(fixture.componentInstance.value()).toBe('日本');
  });

  describe('with a reactive form control', () => {
    let formFixture: ComponentFixture<FormHostComponent>;

    beforeEach(async () => {
      formFixture = TestBed.createComponent(FormHostComponent);
      await formFixture.whenStable();
    });

    const formField = (): HTMLTextAreaElement => (formFixture.nativeElement as HTMLElement).querySelector('textarea') as HTMLTextAreaElement;

    it('writes the control value into the field', () => {
      expect(formField().value).toBe('Runs the weekly sync');
    });

    it('updates the control and its touched state from the field', async () => {
      formField().value = 'Runs the monthly sync';
      formField().dispatchEvent(new Event('input'));
      formField().dispatchEvent(new Event('blur'));
      await formFixture.whenStable();

      expect(formFixture.componentInstance.control.value).toBe('Runs the monthly sync');
      expect(formFixture.componentInstance.control.touched).toBe(true);
    });

    it('follows control.disable() and control.setValue()', async () => {
      formFixture.componentInstance.control.setValue('Archived');
      formFixture.componentInstance.control.disable();
      await formFixture.whenStable();

      expect(formField().value).toBe('Archived');
      expect(formField().disabled).toBe(true);
    });
  });
});

describe('UiTextareaComponent composition buffering', () => {
  const create = async (token?: boolean): Promise<{ fixture: ComponentFixture<UiTextareaComponent>; seen: string[]; field: HTMLTextAreaElement }> => {
    TestBed.configureTestingModule({
      imports: [UiTextareaComponent],
      providers: token === undefined ? [] : [{ provide: COMPOSITION_BUFFER_MODE, useValue: token }],
    });
    const fixture = TestBed.createComponent(UiTextareaComponent);
    const seen: string[] = [];
    fixture.componentInstance.registerOnChange((v) => seen.push(v));
    await fixture.whenStable();
    const field = (fixture.nativeElement as HTMLElement).querySelector('textarea') as HTMLTextAreaElement;
    field.dispatchEvent(new CompositionEvent('compositionstart'));
    field.value = 'sync';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    return { fixture, seen, field };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buffers by default off Android', async () => {
    const { seen } = await create();

    expect(seen).toEqual([]);
  });

  it('does not buffer on Android, where ordinary typing is composition', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile');
    const { seen, fixture, field } = await create();
    field.dispatchEvent(new CompositionEvent('compositionend'));
    await fixture.whenStable();

    expect(seen).toEqual(['sync']);
  });

  it('follows COMPOSITION_BUFFER_MODE: false', async () => {
    const { seen, fixture, field } = await create(false);
    field.dispatchEvent(new CompositionEvent('compositionend'));
    await fixture.whenStable();

    expect(seen).toEqual(['sync']);
  });
});
