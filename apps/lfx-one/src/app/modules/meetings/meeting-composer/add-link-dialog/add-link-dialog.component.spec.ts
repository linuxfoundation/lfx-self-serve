// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddLinkDialogComponent } from './add-link-dialog.component';

/*
 * The dialog's close payload is the whole of what the Agenda & Resources section receives — it
 * appends the link exactly as handed over, and nothing downstream re-validates it. So what the
 * submit lets through, and what it declines to hand over at all, is the entire contract here.
 */
describe('AddLinkDialogComponent — what the submit hands back', () => {
  let fixture: ComponentFixture<AddLinkDialogComponent>;
  const close = vi.fn();

  function form(): FormGroup {
    return (fixture.componentInstance as unknown as { form: FormGroup }).form;
  }

  function onSubmit(): void {
    (fixture.componentInstance as unknown as { onSubmit: () => void }).onSubmit();
  }

  // Reactive-form state is not a signal, so filling the form notifies zoneless change detection of
  // nothing and the `[disabled]="!form.valid"` on the submit button would still be reading the
  // empty form when the click lands. Marking the view dirty is what a real keystroke does for free.
  function render(): void {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }

  function create(): void {
    close.mockClear();

    TestBed.configureTestingModule({
      imports: [AddLinkDialogComponent],
      providers: [{ provide: DynamicDialogRef, useValue: { close } }],
    });

    fixture = TestBed.createComponent(AddLinkDialogComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
    TestBed.resetTestingModule();
  });

  it('hands the section a trimmed title and url', () => {
    create();
    form().patchValue({ title: '  Design doc  ', url: '  https://docs.acme-motors.example/design  ' });
    render();

    expect(form().valid).toBe(true);
    fixture.nativeElement.querySelector('[data-testid="composer-link-submit"] button').click();

    expect(close).toHaveBeenCalledWith({ title: 'Design doc', url: 'https://docs.acme-motors.example/design' });
  });

  /**
   * `Validators.required` is satisfied by a space, which is why `trimmedRequired` sits next to it:
   * a blank-looking row in the agenda is the thing being prevented, not an empty string.
   */
  it('refuses a title that is only whitespace', () => {
    create();
    form().patchValue({ title: '   ', url: 'https://docs.acme-motors.example/design' });

    onSubmit();

    expect(close).not.toHaveBeenCalled();
    expect(form().controls['title'].touched).toBe(true);
  });

  it('refuses a url that is not https', () => {
    create();
    form().patchValue({ title: 'Design doc', url: 'http://docs.acme-motors.example/design' });

    onSubmit();

    expect(close).not.toHaveBeenCalled();
    expect(form().controls['url'].touched).toBe(true);
  });

  /**
   * Nothing is handed over on a cancel — not even the partly filled row. The section reads the
   * close payload to decide whether a link was added at all, so an undefined here is the signal.
   */
  it('closes with nothing when cancelled mid-entry', () => {
    create();
    form().patchValue({ title: 'Design doc', url: 'https://docs.acme-motors.example/design' });
    render();

    fixture.nativeElement.querySelector('[data-testid="composer-link-cancel"] button').click();

    expect(close).toHaveBeenCalledWith();
  });
});
