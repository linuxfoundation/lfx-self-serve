// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FileUpload } from 'primeng/fileupload';
import { describe, expect, it, vi } from 'vitest';
import { FileUploadComponent } from './file-upload.component';

function render(platform: string) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideNoopAnimations(), { provide: PLATFORM_ID, useValue: platform }] });
  const fixture = TestBed.createComponent(FileUploadComponent);
  fixture.detectChanges();
  const upload = fixture.debugElement.query(By.directive(FileUpload)).componentInstance as FileUpload;
  return { fixture, clear: vi.spyOn(upload, 'clear') };
}

describe('FileUploadComponent clear', () => {
  it('does nothing on the server', () => {
    const view = render('server');
    view.fixture.componentInstance.clear(true);
    view.fixture.detectChanges();
    expect(view.clear).not.toHaveBeenCalled();
  });
  it('delegates to PrimeNG without moving focus by default', () => {
    const view = render('browser');
    const button = view.fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const focus = vi.spyOn(button, 'focus');
    view.fixture.componentInstance.clear();
    view.fixture.detectChanges();
    expect(view.clear).toHaveBeenCalledTimes(1);
    expect(focus).not.toHaveBeenCalled();
  });
  it('restores focus to the first button after rendering when requested', async () => {
    const view = render('browser');
    const button = view.fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const focus = vi.spyOn(button, 'focus');
    view.fixture.componentInstance.clear(true);
    view.fixture.detectChanges();
    await view.fixture.whenStable();
    expect(view.clear).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
