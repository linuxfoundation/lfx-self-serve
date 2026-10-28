// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { Component, PLATFORM_ID } from '@angular/core';
import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FileUpload } from 'primeng/fileupload';
import { describe, expect, it, vi } from 'vitest';
import { FileUploadComponent } from './file-upload.component';

function render(platform: string, mode: 'advanced' | 'basic' = 'advanced') {
  TestBed.configureTestingModule({
    deferBlockBehavior: DeferBlockBehavior.Manual,
    providers: [provideHttpClient(), provideNoopAnimations(), { provide: PLATFORM_ID, useValue: platform }],
  });
  const fixture = TestBed.createComponent(FileUploadComponent);
  fixture.componentRef.setInput('mode', mode);
  fixture.componentRef.setInput('chooseLabel', 'Choose trackers');
  fixture.detectChanges();
  return fixture;
}

async function renderUploader() {
  const fixture = render('browser');
  const [block] = await fixture.getDeferBlocks();
  await block.render(DeferBlockState.Complete);
  const upload = fixture.debugElement.query(By.directive(FileUpload)).componentInstance as FileUpload;
  return { fixture, clear: vi.spyOn(upload, 'clear') };
}

@Component({
  imports: [FileUploadComponent],
  template: `
    <lfx-file-upload [mode]="mode" [customUpload]="true">
      <ng-template #header><span data-testid="projected-header">Header</span></ng-template>
      <ng-template #content let-files let-choose="chooseCallback">
        <button data-testid="projected-choose" (click)="choose()">Choose {{ files.length }}</button>
      </ng-template>
      <ng-template #chooseicon><span data-testid="projected-icon">+</span></ng-template>
      <ng-template #filelabel let-files
        ><span data-testid="projected-label">Files: {{ files.length }}</span></ng-template
      >
    </lfx-file-upload>
  `,
})
class ProjectionHostComponent {
  public mode: 'advanced' | 'basic' = 'advanced';
}

describe('FileUploadComponent deferred rendering', () => {
  it.each(['basic', 'advanced'] as const)('shows the %s placeholder before the uploader renders', (mode) => {
    const fixture = render('browser', mode);
    const root: HTMLElement = fixture.nativeElement;
    const placeholder = root.querySelector('[data-testid="file-upload-placeholder"]');
    expect(placeholder?.getAttribute('aria-busy')).toBe('true');
    expect(placeholder?.textContent).toContain('Choose trackers');
    expect(fixture.debugElement.query(By.directive(FileUpload))).toBeNull();
    expect(root.querySelector('input[type="file"]')).toBeNull();
    if (mode === 'basic') {
      const button = placeholder?.querySelector('button');
      expect(button?.disabled).toBe(true);
      expect(button?.classList.contains('p-button-outlined')).toBe(true);
    } else {
      expect(placeholder?.querySelector('.border-2.p-8')).not.toBeNull();
    }
    expect(() => fixture.componentInstance.clear(true)).not.toThrow();
  });

  it('renders the uploader after the deferred block resolves and emits onCustomUpload for basic auto selection', async () => {
    const fixture = render('browser', 'basic');
    fixture.componentRef.setInput('auto', true);
    fixture.componentRef.setInput('customUpload', true);
    const selected = vi.fn();
    const uploaded = vi.fn();
    fixture.componentInstance.onSelect.subscribe(selected);
    fixture.componentInstance.onCustomUpload.subscribe(uploaded);
    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Complete);
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="file-upload-placeholder"]')).toBeNull();
    const input = root.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(['company\nSynthetic Foundation'], 'tracker.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input?.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ files: [file] }));
    expect(uploaded).toHaveBeenCalledWith(expect.objectContaining({ files: [file] }));
  });

  it.each(['basic', 'advanced'] as const)('preserves %s projected templates and callbacks after rendering', async (mode) => {
    TestBed.configureTestingModule({
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [provideHttpClient(), provideNoopAnimations()],
    });
    const fixture = TestBed.createComponent(ProjectionHostComponent);
    fixture.componentInstance.mode = mode;
    fixture.detectChanges();
    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Complete);
    const root: HTMLElement = fixture.nativeElement;
    const input = root.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input) {
      const choose = vi.spyOn(input, 'click').mockImplementation(() => undefined);
      if (mode === 'advanced') {
        expect(root.querySelector('[data-testid="projected-header"]')).not.toBeNull();
        const button = root.querySelector<HTMLButtonElement>('[data-testid="projected-choose"]');
        expect(button?.textContent).toContain('Choose 0');
        button?.click();
        expect(choose).toHaveBeenCalledOnce();
      } else {
        expect(root.querySelector('[data-testid="projected-icon"]')).not.toBeNull();
        expect(root.querySelector('[data-testid="projected-label"]')?.textContent).toBe('Files: 0');
        root.querySelector('button')?.click();
        expect(choose).toHaveBeenCalledOnce();
      }
    }
  });
});

describe('FileUploadComponent clear', () => {
  it('does nothing on the server', () => {
    const fixture = render('server');
    fixture.componentInstance.clear(true);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(FileUpload))).toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
  it('delegates to PrimeNG without moving focus by default', async () => {
    const view = await renderUploader();
    const button = view.fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const focus = vi.spyOn(button, 'focus');
    view.fixture.componentInstance.clear();
    view.fixture.detectChanges();
    expect(view.clear).toHaveBeenCalledTimes(1);
    expect(focus).not.toHaveBeenCalled();
  });
  it('restores focus to the first button after rendering when requested', async () => {
    const view = await renderUploader();
    const button = view.fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const focus = vi.spyOn(button, 'focus');
    view.fixture.componentInstance.clear(true);
    view.fixture.detectChanges();
    await view.fixture.whenStable();
    expect(view.clear).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
