// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MKTG_SLIDES_EXPORT_FAILURE_MESSAGES, MKTG_SLIDES_EXPORT_LOGO_NOTES, MKTG_SLIDES_EXPORT_START_MESSAGES } from '@lfx-one/shared/constants';
import {
  MktgSlidesExportLastResponse,
  MktgSlidesExportRecord,
  MktgSlidesExportResultResponse,
  MktgSlidesExportStartResponse,
  MktgSlidesExportTarget,
} from '@lfx-one/shared/interfaces';
import { provideMktgSlidesExportStub } from '@shared/testing/mktg-slides-export-test-service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgSlidesExportComponent } from './mktg-slides-export.component';

const SHA = 'a'.repeat(64);
const DECK_LINK = 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit';
const TARGET: MktgSlidesExportTarget = { project: 'proj-1', agentKey: 'foundation-message', documentId: 'living', revisionId: `000002-${SHA}` };

function record(overrides: Partial<MktgSlidesExportRecord> = {}): MktgSlidesExportRecord {
  return {
    schema: 'mktg-slides-export/v1',
    project: 'proj-1',
    agentKey: 'foundation-message',
    documentId: 'living',
    revisionId: `000002-${SHA}`,
    revisionNumber: 2,
    contentSha256: SHA,
    mode: 'create',
    deckId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
    link: DECK_LINK,
    title: 'TestOrbit · Messaging framework · 2026-10-19',
    slideCount: 17,
    assets: ['framework', 'kit'],
    branded: { kit: true, logo: false, backgrounds: 5, text_colors: 2, fonts: 15, bars: 2, logos: 0, logos_skipped: 0, tables_header: '#4D4E4E' },
    exportedAt: '2026-10-19T10:00:00.000Z',
    agentVersion: '1.0.2',
    ...overrides,
  };
}

/** A host that drives the panel as the asset views do: the header's button calls `onExport`. */
@Component({
  selector: 'lfx-test-slides-export-host',
  imports: [MktgSlidesExportComponent],
  template: `
    <button type="button" data-testid="host-export" (click)="exporter.onExport()">Export</button>
    <lfx-mktg-slides-export #exporter [target]="target()" [lookupTarget]="lookupTarget()" />
  `,
})
class HostComponent {
  public readonly target = signal<MktgSlidesExportTarget | null>(TARGET);
  public readonly lookupTarget = signal<MktgSlidesExportTarget | null>(null);
}

describe('MktgSlidesExportComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let lastResponse: MktgSlidesExportLastResponse;
  let started: MktgSlidesExportStartResponse;
  let pollResult: Observable<MktgSlidesExportResultResponse>;
  let service: {
    last: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    poll: ReturnType<typeof vi.fn>;
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => element().querySelector(`[data-testid="${testId}"]`);
  const click = async (testId: string): Promise<void> => {
    (query(testId)?.querySelector('button') ?? query(testId))?.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };

  async function setup(platformId: 'browser' | 'server' = 'browser'): Promise<void> {
    service = {
      last: vi.fn(() => of(lastResponse)),
      start: vi.fn(() => of(started)),
      poll: vi.fn(() => pollResult),
    };
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations(), provideMktgSlidesExportStub(service), { provide: PLATFORM_ID, useValue: platformId }],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  }

  beforeEach(() => {
    lastResponse = { last: null, latestRevision: { id: `000002-${SHA}`, number: 2, contentSha256: SHA } };
    started = {
      sessionId: 'session-1',
      ownerToken: 'token',
      revision: { id: `000002-${SHA}`, number: 2, contentSha256: SHA },
      mode: 'create',
      logoNote: 'not-public',
    };
    pollResult = of({ status: 'ready', record: record() });
  });

  it('shows nothing until there is a last export or an export under way', async () => {
    await setup();

    expect(service.last).toHaveBeenCalledWith(TARGET);
    expect(query('mktg-slides-export-panel')).toBeNull();
    expect(element().querySelector('lfx-mktg-slides-export')?.classList.contains('hidden')).toBe(true);
  });

  it('reads document history before approved bytes without authorizing an export or repeating the lookup', async () => {
    lastResponse = { ...lastResponse, last: record() };
    await setup();
    service.last.mockClear();
    const host = fixture.componentInstance;
    host.target.set(null);
    host.lookupTarget.set({ project: TARGET.project, agentKey: TARGET.agentKey, documentId: TARGET.documentId });
    await fixture.whenStable();
    expect(service.last).toHaveBeenCalledTimes(1);
    expect(query('mktg-slides-export-last-link')).not.toBeNull();
    const exporter = fixture.debugElement.query(By.directive(MktgSlidesExportComponent)).componentInstance as MktgSlidesExportComponent;
    expect(exporter.canExport()).toBe(false);
    await click('host-export');
    expect(service.start).not.toHaveBeenCalled();
    host.target.set(TARGET);
    await fixture.whenStable();
    expect(exporter.canExport()).toBe(true);
    expect(service.last).toHaveBeenCalledTimes(1);
    host.target.set({ ...TARGET, project: 'another-synthetic-project' });
    await fixture.whenStable();
    expect(exporter.canExport()).toBe(false);
  });

  it('creates a deck straight away when none exists: progress, then the deck in a new tab, its slides and its brand', async () => {
    pollResult = new Observable<MktgSlidesExportResultResponse>(() => undefined);
    await setup();

    await click('host-export');

    expect(service.start).toHaveBeenCalledWith({ ...TARGET, mode: 'create' });
    expect(service.poll).toHaveBeenCalledWith(TARGET, started);
    expect(query('mktg-slides-export-running')?.textContent).toContain('Exporting the messaging framework to Google Slides');

    pollResult = of({ status: 'ready', record: record() });
    await click('host-export');
    // A second click while an export runs starts nothing new.
    expect(service.start).toHaveBeenCalledTimes(1);
  });

  it('shows the finished deck with what was branded and why the logo was not applied', async () => {
    await setup();

    await click('host-export');

    const open = query('mktg-slides-export-open') as HTMLAnchorElement;
    expect(open.href).toBe(DECK_LINK);
    expect(open.target).toBe('_blank');
    expect(open.rel).toContain('noopener');
    expect(query('mktg-slides-export-detail')?.textContent).toContain('17 slides · a new deck in Google Drive');
    expect(query('mktg-slides-export-brand')?.textContent).toContain('In the kit’s colours and typeface.');
    expect(query('mktg-slides-export-logo-note')?.textContent).toContain(MKTG_SLIDES_EXPORT_LOGO_NOTES['not-public']);
  });

  it('shows the last export with its date, and marks it out of date when the asset has a newer revision', async () => {
    lastResponse = {
      last: record({ revisionNumber: 1, contentSha256: 'b'.repeat(64) }),
      latestRevision: { id: `000002-${SHA}`, number: 2, contentSha256: SHA },
    };
    await setup();

    expect((query('mktg-slides-export-last-link') as HTMLAnchorElement).href).toBe(DECK_LINK);
    expect(query('mktg-slides-export-last')?.textContent).toContain('19 Oct 2026');
    expect(query('mktg-slides-export-last')?.textContent).toContain('from revision 1');
    expect(query('mktg-slides-export-stale')?.textContent).toContain('the messaging framework has a newer revision');
  });

  it('offers Update or Create when a deck exists, and updates the same deck when asked', async () => {
    lastResponse = { last: record(), latestRevision: { id: `000002-${SHA}`, number: 2, contentSha256: SHA } };
    pollResult = of({ status: 'ready', record: record({ mode: 'update', title: null }) });
    await setup();
    expect(query('mktg-slides-export-stale')).toBeNull();

    await click('host-export');
    expect(service.start).not.toHaveBeenCalled();
    expect(query('mktg-slides-export-choice')?.textContent).toContain('A deck already exists for this messaging framework');

    await click('mktg-slides-export-update');

    expect(service.start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'update' }));
    expect(query('mktg-slides-export-detail')?.textContent).toContain('the same deck, refreshed in place');
  });

  it('shows a failure as a plain message with a retry, and the deck it left behind', async () => {
    pollResult = of({ status: 'failed', failure: 'partial', message: MKTG_SLIDES_EXPORT_FAILURE_MESSAGES.partial, deckLink: DECK_LINK });
    await setup();

    await click('host-export');

    expect(query('mktg-slides-export-failed')?.textContent).toContain(MKTG_SLIDES_EXPORT_FAILURE_MESSAGES.partial);
    expect((query('mktg-slides-export-partial-deck') as HTMLAnchorElement).href).toBe(DECK_LINK);

    pollResult = of({ status: 'ready', record: record() });
    await click('mktg-slides-export-retry');
    expect(service.start).toHaveBeenCalledTimes(2);
    expect(query('mktg-slides-export-done')).not.toBeNull();
  });

  it('offers a new deck when the last one is no longer a presentation', async () => {
    lastResponse = { last: record(), latestRevision: null };
    pollResult = of({ status: 'failed', failure: 'not-a-deck', message: MKTG_SLIDES_EXPORT_FAILURE_MESSAGES['not-a-deck'], deckLink: null });
    await setup();
    await click('host-export');
    await click('mktg-slides-export-update');

    expect(query('mktg-slides-export-retry')).toBeNull();
    pollResult = of({ status: 'ready', record: record() });
    await click('mktg-slides-export-create-instead');
    expect(service.start).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'create' }));
  });

  it('says why a start was refused, in plain words', async () => {
    await setup();
    service.start.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'x', code: 'REVISION_NOT_STORED' } })));

    await click('host-export');

    expect(query('mktg-slides-export-failed')?.textContent).toContain(MKTG_SLIDES_EXPORT_START_MESSAGES['REVISION_NOT_STORED']);
  });

  it('keeps showing the document’s export under way when the page names another of its revisions, and reads its last export', async () => {
    let unsubscribed = false;
    const results = new Subject<MktgSlidesExportResultResponse>();
    pollResult = new Observable<MktgSlidesExportResultResponse>((subscriber) => {
      const inner = results.subscribe(subscriber);
      return () => {
        unsubscribed = true;
        inner.unsubscribe();
      };
    });
    await setup();
    const exporter = fixture.debugElement.query(By.directive(MktgSlidesExportComponent)).componentInstance as MktgSlidesExportComponent;
    await click('host-export');
    expect(query('mktg-slides-export-running')).not.toBeNull();

    lastResponse = { last: null, latestRevision: null };
    fixture.componentInstance.target.set({ ...TARGET, revisionId: `000001-${'c'.repeat(64)}` });
    await fixture.whenStable();

    // The deck is the document's: its export goes on, the panel shows it, and Export waits for it.
    expect(unsubscribed).toBe(false);
    expect(query('mktg-slides-export-running')).not.toBeNull();
    expect(exporter.canExport()).toBe(false);
    expect(service.last).toHaveBeenCalledTimes(2);

    results.next({ status: 'ready', record: record() });
    await fixture.whenStable();
    expect(query('mktg-slides-export-done')).not.toBeNull();
    expect(service.start).toHaveBeenCalledTimes(1);
  });

  it('attaches to an export still under way when the panel comes back to its document, never starting a second deck', async () => {
    const results = new Subject<MktgSlidesExportResultResponse>();
    pollResult = results;
    await setup();
    await click('host-export');

    // The page goes elsewhere (another project's asset), then comes back while the export still runs.
    lastResponse = { last: null, latestRevision: null };
    fixture.componentInstance.target.set({ ...TARGET, project: 'proj-2' });
    await fixture.whenStable();
    expect(query('mktg-slides-export-running')).toBeNull();
    fixture.componentInstance.target.set(TARGET);
    await fixture.whenStable();

    expect(query('mktg-slides-export-running')).not.toBeNull();
    await click('host-export');
    expect(service.start).toHaveBeenCalledTimes(1);

    results.next({ status: 'ready', record: record() });
    await fixture.whenStable();
    expect(query('mktg-slides-export-open')?.getAttribute('href')).toBe(DECK_LINK);
  });

  it('says so when the last export cannot be read, and holds Export until a check succeeds', async () => {
    await setup();
    const exporter = fixture.debugElement.query(By.directive(MktgSlidesExportComponent)).componentInstance as MktgSlidesExportComponent;
    service.last.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    fixture.componentInstance.target.set({ ...TARGET, revisionId: `000001-${'c'.repeat(64)}` });
    await fixture.whenStable();

    expect(query('mktg-slides-export-lookup-failed')).not.toBeNull();
    expect(exporter.canExport()).toBe(false);
    await click('host-export');
    expect(service.start).not.toHaveBeenCalled();

    lastResponse = { last: record(), latestRevision: null };
    await click('mktg-slides-export-check-again');

    expect(service.last).toHaveBeenCalledTimes(3);
    expect(query('mktg-slides-export-lookup-failed')).toBeNull();
    expect(exporter.canExport()).toBe(true);
    await click('host-export');
    expect(query('mktg-slides-export-choice')).not.toBeNull();
    expect(service.start).not.toHaveBeenCalled();
  });

  it('keeps the failed check on screen while it checks again, so a slow check never takes away the retry', async () => {
    await setup();
    const exporter = fixture.debugElement.query(By.directive(MktgSlidesExportComponent)).componentInstance as MktgSlidesExportComponent;
    service.last.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    fixture.componentInstance.target.set({ ...TARGET, revisionId: `000001-${'c'.repeat(64)}` });
    await fixture.whenStable();
    expect(query('mktg-slides-export-lookup-failed')).not.toBeNull();

    const lookup = new Subject<MktgSlidesExportLastResponse>();
    service.last.mockReturnValueOnce(lookup);
    await click('mktg-slides-export-check-again');

    // The check is under way: the line and its (checking) button stay, Export still waits, and a second click asks nothing more.
    expect(exporter.visible()).toBe(true);
    expect(query('mktg-slides-export-lookup-failed')).not.toBeNull();
    expect(query('mktg-slides-export-check-again')?.textContent).toContain('Checking');
    expect(exporter.canExport()).toBe(false);
    await click('mktg-slides-export-check-again');
    expect(service.last).toHaveBeenCalledTimes(3);

    // It fails again: the line offers Check again once more.
    lookup.error(new HttpErrorResponse({ status: 503 }));
    await fixture.whenStable();
    expect(query('mktg-slides-export-lookup-failed')).not.toBeNull();
    expect(query('mktg-slides-export-check-again')?.textContent).toContain('Check again');

    await click('mktg-slides-export-check-again');
    expect(service.last).toHaveBeenCalledTimes(4);
    expect(query('mktg-slides-export-lookup-failed')).toBeNull();
    expect(exporter.canExport()).toBe(true);
  });

  it('retries an Update the panel came back to as an Update, never as a second deck', async () => {
    const results = new Subject<MktgSlidesExportResultResponse>();
    lastResponse = { last: record(), latestRevision: null };
    pollResult = results;
    await setup();
    await click('host-export');
    await click('mktg-slides-export-update');
    expect(service.start).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'update' }));

    // The page is left and opened again while the update still runs: a new panel attaches to it.
    fixture.destroy();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    expect(query('mktg-slides-export-running')).not.toBeNull();

    // The poll answers once and ends, as the real one does.
    results.next({ status: 'failed', failure: 'google', message: MKTG_SLIDES_EXPORT_FAILURE_MESSAGES.google, deckLink: null });
    results.complete();
    await fixture.whenStable();
    expect(query('mktg-slides-export-failed')).not.toBeNull();

    pollResult = of({ status: 'ready', record: record({ mode: 'update' }) });
    await click('mktg-slides-export-retry');
    expect(service.start).toHaveBeenCalledTimes(2);
    expect(service.start).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'update' }));
    expect(query('mktg-slides-export-detail')?.textContent).toContain('the same deck, refreshed in place');
  });

  it('takes no Export click until the last export is read, so an existing deck is offered Update and never duplicated', async () => {
    const lookup = new Subject<MktgSlidesExportLastResponse>();
    await setup();
    service.last.mockReturnValue(lookup);
    const exporter = fixture.debugElement.query(By.directive(MktgSlidesExportComponent)).componentInstance as MktgSlidesExportComponent;
    expect(exporter.canExport()).toBe(true);

    // The page names another revision of the same document: its last export is read again, and is slow to answer.
    fixture.componentInstance.target.set({ ...TARGET, revisionId: `000001-${'c'.repeat(64)}` });
    await fixture.whenStable();
    expect(exporter.canExport()).toBe(false);

    await click('host-export');
    expect(service.start).not.toHaveBeenCalled();
    expect(query('mktg-slides-export-choice')).toBeNull();

    lookup.next({ last: record(), latestRevision: { id: `000002-${SHA}`, number: 2, contentSha256: SHA } });
    await fixture.whenStable();
    expect(exporter.canExport()).toBe(true);

    await click('host-export');
    expect(service.start).not.toHaveBeenCalled();
    expect(query('mktg-slides-export-choice')).not.toBeNull();
  });

  it('holds Export on first load until the last export is read', async () => {
    const lookup = new Subject<MktgSlidesExportLastResponse>();
    lastResponse = { last: record(), latestRevision: null };
    service = { last: vi.fn(() => lookup), start: vi.fn(() => of(started)), poll: vi.fn(() => pollResult) };
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations(), provideMktgSlidesExportStub(service), { provide: PLATFORM_ID, useValue: 'browser' }],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();

    await click('host-export');
    expect(service.start).not.toHaveBeenCalled();

    lookup.next(lastResponse);
    await fixture.whenStable();
    await click('host-export');
    expect(service.start).not.toHaveBeenCalled();
    expect(query('mktg-slides-export-choice')).not.toBeNull();
  });

  it('never shows a finished deck under another asset', async () => {
    await setup();
    await click('host-export');
    expect(query('mktg-slides-export-done')).not.toBeNull();

    lastResponse = { last: null, latestRevision: null };
    fixture.componentInstance.target.set({ ...TARGET, project: 'proj-2' });
    await fixture.whenStable();

    expect(query('mktg-slides-export-done')).toBeNull();
    expect(query('mktg-slides-export-panel')).toBeNull();
  });

  it('reads nothing on the server', async () => {
    await setup('server');

    expect(service.last).not.toHaveBeenCalled();
  });
});
