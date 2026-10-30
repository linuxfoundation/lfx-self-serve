// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BRAND_KIT_INTAKE, MKTG_DRIVE_SHARING_HINT } from '@lfx-one/shared/constants';
import { MktgIntakeLogoFilesConfig } from '@lfx-one/shared/interfaces';
import type { FileSelectEvent } from 'primeng/fileupload';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgIntakeLogoFilesComponent } from './mktg-intake-logo-files.component';

/**
 * A FileReader the test finishes by hand, so a read's order and timing are
 * the test's: `finish` hands the reader its result and fires `onload`;
 * `fail` fires `onerror`. The real reader is kept for the happy paths, which
 * check what the browser actually hands over.
 */
class HandFileReader {
  public static readonly instances: HandFileReader[] = [];
  public result: string | ArrayBuffer | null = null;
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  /** Which read was asked for — an SVG goes as text, anything else as a data URL. */
  public read: 'text' | 'dataUrl' | null = null;
  /** Whether the read was aborted; a real reader fires neither `onload` nor `onerror` after it. */
  public aborted = false;

  public constructor() {
    HandFileReader.instances.push(this);
  }

  public readAsText(): void {
    this.read = 'text';
  }

  public readAsDataURL(): void {
    this.read = 'dataUrl';
  }

  public finish(result: string): void {
    this.result = result;
    this.onload?.();
  }

  public fail(): void {
    this.onerror?.();
  }

  public abort(): void {
    this.aborted = true;
  }
}

describe('MktgIntakeLogoFilesComponent', () => {
  const liveConfig = BRAND_KIT_INTAKE.logoFiles as MktgIntakeLogoFilesConfig;
  /** The live section with small caps, so the refusals are reachable with files of a few bytes. */
  const config: MktgIntakeLogoFilesConfig = { ...liveConfig, maxFiles: 3, maxFileChars: 40, maxPayloadChars: 60 };
  let fixture: ComponentFixture<MktgIntakeLogoFilesComponent>;
  let component: MktgIntakeLogoFilesComponent;
  const realFileReader = globalThis.FileReader;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => host().querySelector(`[data-testid="${testId}"]`);
  const fileEvent = (...files: File[]): FileSelectEvent => ({ originalEvent: new Event('change'), files, currentFiles: files });
  const names = (): string[] => component.files().map((entry) => entry.file.name);
  const settled = async (): Promise<void> => {
    await vi.waitFor(() => expect(component.busy()).toBe(false));
    await fixture.whenStable();
  };
  const useHandReader = (): void => {
    HandFileReader.instances.length = 0;
    vi.stubGlobal('FileReader', HandFileReader);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MktgIntakeLogoFilesComponent],
      // The LFX file-upload wrapper's PrimeNG uploader injects HttpClient; the testing backend keeps every request local.
      providers: [provideNoopAnimations(), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MktgIntakeLogoFilesComponent);
    fixture.componentRef.setInput('config', config);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    expect(globalThis.FileReader).toBe(realFileReader);
  });

  it('describes the logo link input with the shared LF-wide Drive sharing guidance before typing', () => {
    const input = host().querySelector<HTMLInputElement>('[data-test="mktg-intake-logo-files-link-input"]');
    const hint = host().querySelector('#mktg-intake-logo-files-link-hint');
    expect(hint?.textContent?.trim()).toBe(MKTG_DRIVE_SHARING_HINT);
    expect(input?.getAttribute('aria-describedby')).toBe(hint?.id);
  });

  it('reads an SVG as its text and lists it as sent as text', async () => {
    component['onFilesSelected'](fileEvent(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })));
    expect(component.busy()).toBe(true);
    await settled();

    expect(component.files()).toEqual([expect.objectContaining({ badge: 'SVG', status: '6 B, sent as text', file: { name: 'logo.svg', text: '<svg/>' } })]);
    expect(query('mktg-intake-logo-files-list')?.textContent).toContain('logo.svg');
    expect(component['errorText']()).toBe('');
  });

  it('reads a PNG as its base64 bytes, cut after the data URL comma, and lists it as sent as bytes', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    component['onFilesSelected'](fileEvent(new File([bytes], 'mark.png', { type: 'image/png' })));
    await settled();

    expect(component.files()).toEqual([
      expect.objectContaining({ badge: 'PNG', status: '4 B, sent as bytes', file: { name: 'mark.png', base64: 'iVBORw==' } }),
    ]);
  });

  it('refuses a file that is not an SVG, PNG or ZIP, and a name already on the form, before reading anything', async () => {
    component['onFilesSelected'](fileEvent(new File(['x'], 'logo.pdf')));
    expect(component.busy()).toBe(false);
    expect(component['errorText']()).toBe('logo.pdf: not an SVG, PNG or ZIP file.');

    component['onFilesSelected'](fileEvent(new File(['<svg/>'], 'logo.svg')));
    await settled();
    useHandReader();
    component['onFilesSelected'](fileEvent(new File(['<svg/>'], 'logo.svg')));

    expect(HandFileReader.instances).toHaveLength(0);
    expect(component['errorText']()).toBe('logo.svg is already on the form.');
    expect(names()).toEqual(['logo.svg']);
  });

  it('refuses an empty file, and one bigger than a file may be once read, pointing to a link instead', () => {
    useHandReader();
    component['onFilesSelected'](fileEvent(new File([''], 'empty.svg'), new File(['x'], 'big.svg')));
    HandFileReader.instances[0].finish('');
    expect(component['errorText']()).toBe('empty.svg: the file is empty.');

    HandFileReader.instances[1].finish('<svg>'.padEnd(config.maxFileChars + 1, 'x'));
    expect(component['errorText']()).toBe('big.svg is too big to send with the form — add it as a link instead.');
    expect(component.files()).toEqual([]);
    expect(component.busy()).toBe(false);
  });

  it('refuses a file from its size before reading it, so a large package is never read only to be refused', () => {
    useHandReader();
    // 31 bytes are 44 base64 characters, over the cap of 40; an SVG of 121 bytes is at least 41 characters.
    component['onFilesSelected'](fileEvent(new File([new Uint8Array(31)], 'kit.zip')));
    expect(component['errorText']()).toBe('kit.zip is too big to send with the form — add it as a link instead.');
    component['onFilesSelected'](fileEvent(new File(['x'.repeat(121)], 'huge.svg')));
    expect(component['errorText']()).toBe('huge.svg is too big to send with the form — add it as a link instead.');

    // An SVG is as many request bytes as its file: 61 bytes pass the payload cap of 60 before any read; 60 bytes are read.
    component['onFilesSelected'](fileEvent(new File(['x'.repeat(61)], 'over.svg')));
    expect(component['errorText']()).toBe('over.svg would take the files over what one request can carry — add it as a link instead.');
    component['onFilesSelected'](fileEvent(new File(['x'.repeat(60)], 'edge.svg')));
    expect(HandFileReader.instances).toHaveLength(1);
    expect(component.busy()).toBe(true);
  });

  it('counts the reads in flight against the payload cap, so one pick of several large files is not all read', () => {
    useHandReader();
    // 24 bytes are 32 base64 characters each: under the per-file cap of 40, but two of them pass the payload cap of 60.
    component['onFilesSelected'](fileEvent(new File([new Uint8Array(24)], 'a.png'), new File([new Uint8Array(24)], 'b.png')));

    expect(HandFileReader.instances).toHaveLength(1);
    expect(component['errorText']()).toBe('b.png would take the files over what one request can carry — add it as a link instead.');
  });

  it('measures the request in UTF-8 bytes, so an SVG of multi-byte text cannot pass the body limit by its character count', () => {
    useHandReader();
    component['onFilesSelected'](fileEvent(new File(['x'], 'a.svg')));
    // 23 characters, 18 of them CJK, are 59 UTF-8 bytes: under the per-file cap of 40 characters and the payload cap of 60 bytes.
    HandFileReader.instances[0].finish('<svg>'.padEnd(23, '字'));
    expect(names()).toEqual(['a.svg']);

    component['onFilesSelected'](fileEvent(new File(['x'], 'b.svg')));
    // 6 more bytes pass the cap, though the two files are only 29 characters.
    HandFileReader.instances[1].finish('<svg/>');
    expect(names()).toEqual(['a.svg']);
    expect(component['errorText']()).toBe('b.svg would take the files over what one request can carry — add it as a link instead.');
  });

  it('refuses a file that would take all the files past what one request can carry', () => {
    useHandReader();
    component['onFilesSelected'](fileEvent(new File(['x'], 'a.svg'), new File(['x'], 'b.svg')));
    HandFileReader.instances[0].finish('<svg>'.padEnd(35, 'a'));
    HandFileReader.instances[1].finish('<svg>'.padEnd(35, 'b'));

    expect(names()).toEqual(['a.svg']);
    expect(component['errorText']()).toBe('b.svg would take the files over what one request can carry — add it as a link instead.');
  });

  it('takes at most the configured number of files, counting reads still in flight, and disables the controls at the limit', async () => {
    useHandReader();
    component['onFilesSelected'](fileEvent(new File(['x'], 'a.svg'), new File(['x'], 'b.svg'), new File(['x'], 'c.svg'), new File(['x'], 'd.svg')));

    // d.svg is refused while a, b and c are still being read.
    expect(HandFileReader.instances).toHaveLength(3);
    expect(component['errorText']()).toBe('At most 3 files.');

    HandFileReader.instances.forEach((reader, index) => reader.finish(`<svg>${index}</svg>`));
    await fixture.whenStable();
    expect(names()).toEqual(['a.svg', 'b.svg', 'c.svg']);
    expect(component['atLimit']()).toBe(true);
    expect(host().querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    expect(query('mktg-intake-logo-files-add-link')?.querySelector('button')?.disabled).toBe(true);

    component['linkForm'].controls.url.setValue('https://one.example.org/logo.svg');
    component['onAddLink']();
    expect(component['errorText']()).toBe('At most 3 files.');
    expect(names()).toEqual(['a.svg', 'b.svg', 'c.svg']);
  });

  it('is busy until the last read finishes, and reports a read that fails', async () => {
    useHandReader();
    component['onFilesSelected'](fileEvent(new File(['x'], 'a.svg'), new File(['x'], 'b.png')));
    expect(component.busy()).toBe(true);
    expect(HandFileReader.instances.map((reader) => reader.read)).toEqual(['text', 'dataUrl']);
    await fixture.whenStable();
    expect(query('mktg-intake-logo-files-pending')?.textContent).toContain('Reading 2 file(s)');

    HandFileReader.instances[1].finish('data:image/png;base64,AAAA');
    expect(component.busy()).toBe(true);
    expect(names()).toEqual(['b.png']);

    HandFileReader.instances[0].fail();
    expect(component.busy()).toBe(false);
    expect(component['errorText']()).toBe('a.svg: the file could not be read. Try again, or add it as a link.');
    await fixture.whenStable();
    expect(query('mktg-intake-logo-files-pending')).toBeNull();
  });

  it('lists a link as given, named after its last path segment, never reading it — the agent fetches it', async () => {
    useHandReader();
    component['linkForm'].controls.url.setValue(' https://one.example.org/assets/brand/Logo%20Mark.svg ');

    component['onAddLink']();
    await fixture.whenStable();

    expect(HandFileReader.instances).toHaveLength(0);
    expect(component.files()).toEqual([
      expect.objectContaining({
        badge: 'LINK',
        status: 'the agent fetches it',
        file: { name: 'Logo Mark.svg', url: 'https://one.example.org/assets/brand/Logo%20Mark.svg' },
      }),
    ]);
    expect(component.busy()).toBe(false);
    expect(component['linkForm'].controls.url.value).toBe('');

    // A link with no path is named after its host; the same name twice is refused.
    component['linkForm'].controls.url.setValue('https://one.example.org');
    component['onAddLink']();
    expect(names()).toEqual(['Logo Mark.svg', 'one.example.org']);
    component['linkForm'].controls.url.setValue('https://one.example.org/');
    component['onAddLink']();
    expect(component['errorText']()).toBe('one.example.org is already on the form.');
    expect(names()).toEqual(['Logo Mark.svg', 'one.example.org']);
  });

  it('names a link after the base name of its decoded last segment, so an encoded separator never reaches the server', () => {
    const url = 'https://one.example.org/files/brand%2Flogo.svg';
    component['linkForm'].controls.url.setValue(url);
    component['onAddLink']();
    component['linkForm'].controls.url.setValue('https://two.example.org/kit%5Cmark.png');
    component['onAddLink']();
    component['linkForm'].controls.url.setValue('https://three.example.org/bad%E0%A4%A.svg');
    component['onAddLink']();

    expect(names()).toEqual(['logo.svg', 'mark.png', 'bad%E0%A4%A.svg']);
    expect(component.files()[0].file).toEqual({ name: 'logo.svg', url });
  });

  it('refuses a link that is not https://, and an empty one', () => {
    component['linkForm'].controls.url.setValue('http://one.example.org/logo.svg');
    component['onAddLink']();
    expect(component.files()).toEqual([]);
    expect(component['errorText']()).toBe('Enter the full link to the file, starting with https://.');

    component['linkForm'].controls.url.setValue('   ');
    component['onAddLink']();
    expect(component.files()).toEqual([]);
    expect(component['errorText']()).toBe('Enter the full link to the file, starting with https://.');
  });

  it('drops the reads in flight on cancelReads — a file picked before a project switch never lands on the next form', () => {
    useHandReader();
    component['onFilesSelected'](fileEvent(new File(['x'], 'a.svg'), new File(['x'], 'b.png')));
    expect(component.busy()).toBe(true);

    component.cancelReads();

    expect(HandFileReader.instances.every((reader) => reader.aborted)).toBe(true);
    expect(component.busy()).toBe(false);
    expect(component['pending']()).toBe(0);
    HandFileReader.instances[0].finish('<svg/>');
    HandFileReader.instances[1].fail();
    expect(component.files()).toEqual([]);
    expect(component['errorText']()).toBe('');
  });

  it('aborts the reads in flight when the section goes', () => {
    useHandReader();
    component['onFilesSelected'](fileEvent(new File(['x'], 'a.svg')));

    fixture.destroy();

    expect(HandFileReader.instances[0].aborted).toBe(true);
    expect(HandFileReader.instances[0].onload).toBeNull();
  });

  it('refuses a finished read whose name a link took while it was being read — the server refuses a repeated name', () => {
    useHandReader();
    component['onFilesSelected'](fileEvent(new File(['x'], 'logo.svg')));
    component['linkForm'].controls.url.setValue('https://one.example.org/logo.svg');
    component['onAddLink']();

    HandFileReader.instances[0].finish('<svg/>');

    expect(names()).toEqual(['logo.svg']);
    expect(component.files()[0].badge).toBe('LINK');
    expect(component['errorText']()).toBe('logo.svg is already on the form.');
  });

  it('removes a file from the form', async () => {
    component['onFilesSelected'](fileEvent(new File(['<svg/>'], 'logo.svg')));
    await settled();
    const id = component.files()[0].id;

    component['onRemove'](id);
    await fixture.whenStable();

    expect(component.files()).toEqual([]);
    expect(query('mktg-intake-logo-files-list')).toBeNull();
  });
});
