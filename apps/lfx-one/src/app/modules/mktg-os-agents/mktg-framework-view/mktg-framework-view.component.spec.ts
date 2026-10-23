// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectContextService } from '@services/project-context.service';
import { provideRouter, Router } from '@angular/router';
import { FOUNDATION_MESSAGE_PRINT_BODY_CLASS } from '@lfx-one/shared/constants';
import { BrandKitRevision, MktgFrameworkAsset, MktgFrameworkViewState, MktgSlidesExportTarget, MktgRevisionApproval } from '@lfx-one/shared/interfaces';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgPrintService } from '@services/mktg-print.service';
import { isMktgDocumentCommentAnchor } from '@lfx-one/shared/utils';
import { provideMktgSlidesExportStub } from '@shared/testing/mktg-slides-export-test-service';
import { provideMktgCommentsStub } from '@shared/testing/mktg-comments-test-service';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { NEVER, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgFrameworkViewComponent } from './mktg-framework-view.component';

/** A host that projects the feed or the questions into the view, as the run page does. */
@Component({
  selector: 'lfx-test-framework-host',
  imports: [MktgFrameworkViewComponent],
  templateUrl: './mktg-framework-view.test-host.html',
})
class HostComponent {
  public readonly asset = signal<MktgFrameworkAsset | null>(null);
  public readonly state = signal<MktgFrameworkViewState>('generating');
  public readonly version = signal<number | null>(null);
  public readonly approvedAsset = signal<MktgFrameworkAsset | null>(null);
  public readonly approvedVersion = signal<number | null>(null);
  public readonly kit = signal<BrandKitRevision | null>(null);
  public readonly exportTarget = signal<MktgSlidesExportTarget | null>(null);
  public readonly approval = signal<MktgRevisionApproval | null>(null);
}

const pair = (a: string, b: string): [string, string] => [a, b];

const ASSET: MktgFrameworkAsset = {
  kind: 'messaging-framework',
  mode: 'draft',
  content: {
    mf: {
      vision: 'A vision.',
      mission: 'A mission.',
      positioning: 'For platform teams, TestOrbit is the open release toolkit.',
      tagline: 'Release, open.',
      goals: [
        {
          id: 'adoption',
          n: 1,
          t: 'Adoption',
          vp: 'Adoption VP.',
          key: 'Adoption key.',
          proof: [pair('1,200 members', 'Website')],
          bite: 'Adoption in the open',
          icps: ['users'],
        },
        {
          id: 'community',
          n: 2,
          t: 'Community',
          vp: 'Community VP.',
          key: 'Community key.',
          proof: [pair('40 releases', 'Docs')],
          bite: 'Built together',
          icps: ['contributors'],
        },
      ],
      crosscut: 'Every column grows the audience.',
      say: ['open release', 'community-governed'],
      avoid: [pair('synergy', 'working together')],
      anchor: ['Which goal does this serve?', 'Which segment is it for?', 'Which key message does it carry?'],
      notes: 'Check the member count.',
    },
    icp: [
      {
        id: 'users',
        name: 'End users',
        kind: 'Individual',
        who: 'Engineers running releases.',
        goals: ['adoption'],
        need: 'Reliable releases.',
        value: 'Fewer incidents.',
        lead: 'Ship with confidence.',
        proof: [pair('A fact', 'Docs')],
        cta: 'Try it.',
        channels: ['Docs', 'Events'],
        objection: ['Too early?', 'Adopters are in production.'],
        personas: [pair('SRE', 'uptime')],
        basis: 'Website',
      },
      {
        id: 'contributors',
        name: 'Contributors',
        kind: 'Individual',
        who: 'Maintainers.',
        goals: ['community'],
        need: 'A welcoming project.',
        value: 'Impact.',
        lead: 'Build it with us.',
        proof: [pair('Another fact', 'Web')],
        cta: 'Open a PR.',
        channels: ['GitHub'],
        objection: ['Hard to start?', null],
        personas: [pair('Maintainer', 'review load')],
        basis: 'Inferred',
      },
    ],
    mh: {
      umbrella: 'Open releases for everyone.',
      line: 'Release, open.',
      pillars: [
        { t: 'Open', m: 'Open message.', p: [pair('Fact one', 'Website')] },
        { t: 'Proven', m: 'Proven message.', p: [pair('Fact two', 'Docs')] },
        { t: 'Neutral', m: 'Neutral message.', p: [pair('Fact three', 'Web')] },
      ],
      found: 'A Linux Foundation project.',
      aud: [pair('End users', 'Ship with confidence.'), pair('Contributors', 'Build it with us.')],
    },
    nums: [pair('1,200', 'members'), pair('40', 'releases a year')],
  },
  report: {
    sources_read: ['https://testorbit.example.org'],
    sources_failed: [{ name: 'https://blog.example.org', reason: '404' }],
    gaps: ['No member count.'],
    notes: 'Check the dates.',
  },
  checks: { findings: ['nums has 2 numbers; 3–4'] },
};

describe('MktgFrameworkViewComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let printer: { print: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>; ensureFontStylesheet: ReturnType<typeof vi.fn> };
  let slidesExport: { last: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => element().querySelector(`[data-testid="${testId}"]`);
  const tab = async (id: string): Promise<void> => {
    query(`mktg-framework-view-tab-${id}`)?.click();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    printer = { print: vi.fn(() => Promise.resolve()), clear: vi.fn(), ensureFontStylesheet: vi.fn() };
    slidesExport = {
      last: vi.fn(() => of({ last: null, latestRevision: null })),
      start: vi.fn(() => of({ sessionId: 's', ownerToken: 't', revision: { id: 'r', number: 1, contentSha256: 'a' }, mode: 'create', logoNote: null })),
      poll: vi.fn(() => NEVER),
    };
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ProjectContextService, useValue: { activeContext: () => ({ slug: 'synthetic' }) } },
        { provide: MktgPrintService, useValue: printer },
        provideMktgSlidesExportStub(slidesExport),
        provideMktgCommentsStub(),
        { provide: MktgDependencyService, useValue: { documentsChanged$: NEVER } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('reads shared tab URLs and pushes switches without dropping project or edit state', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?project=synthetic&profile=edit&tab=icps');
    host.asset.set(ASSET);
    host.state.set('ready');
    await fixture.whenStable();
    expect(query('mktg-framework-view-tab-icps')?.getAttribute('aria-selected')).toBe('true');
    const navigate = vi.spyOn(router, 'navigate');
    const push = vi.spyOn(TestBed.inject(Location), 'go');
    await tab('message-house');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { tab: 'message-house', project: 'synthetic' }, queryParamsHandling: 'merge' })
    );
    expect(router.url).toContain('project=synthetic');
    expect(router.url).toContain('profile=edit');
    expect(router.url).toContain('tab=message-house');
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
    await router.navigateByUrl('/?tab=unknown');
    await fixture.whenStable();
    expect(query('mktg-framework-view-tab-framework')?.getAttribute('aria-selected')).toBe('true');
  });

  it('focuses the opened panel start only after routed content renders', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigate = router.navigate.bind(router);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = vi.spyOn(router, 'navigate').mockImplementationOnce(async (...args) => {
      await gate;
      return navigate(...args);
    });
    query('mktg-framework-view-tab-framework')?.focus();
    const before = document.activeElement;
    query('mktg-framework-view-tab-icps')?.click();
    await fixture.whenStable();
    expect(query('mktg-framework-view-panel-icps')).toBeNull();
    expect(document.activeElement).toBe(before);
    release();
    await pending.mock.results[0]?.value;
    await fixture.whenStable();
    const panel = query('mktg-framework-view-panel-icps');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);
    expect(panel?.getAttribute('tabindex')).toBe('-1');
  });

  it('shows a real approval without a duplicate Draft mode and preserves export wiring', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    host.version.set(2);
    host.approval.set({ approvedAt: '2026-10-19T10:00:00Z', approvedBy: { name: null } });
    await fixture.whenStable();
    expect(query('mktg-framework-view-approval-state')?.textContent?.trim()).toBe('Approved');
    expect(query('mktg-framework-view-version')?.textContent?.trim()).toBe('v2');
    expect(query('mktg-framework-view-mode')).toBeNull();
    expect(query('mktg-framework-view-actions')).not.toBeNull();
    expect(query('mktg-framework-view-slides-export')).not.toBeNull();
  });

  it.each([
    ['redraft', 'Redraft'],
    ['check', 'Checked'],
  ] as const)('retains distinct %s mode metadata', async (mode, label) => {
    host.asset.set({ ...ASSET, mode });
    host.state.set('ready');
    host.version.set(1);
    await fixture.whenStable();
    expect(query('mktg-framework-view-mode')?.textContent?.trim()).toBe(label);
  });

  it('shows the generating state with the projected feed where the framework will be, tabs disabled', () => {
    expect(query('mktg-framework-view-title')?.textContent).toContain('TestOrbit Messaging framework');
    expect(query('mktg-framework-view-state')?.textContent).toContain('Generating');
    expect(query('mktg-framework-view-generating')?.textContent).toContain('The feed goes here');
    expect(query('mktg-framework-view-panel-framework')).toBeNull();
    expect(element().querySelectorAll<HTMLButtonElement>('[role="tab"]').length).toBe(5);
    expect(element().querySelectorAll<HTMLButtonElement>('[role="tab"]:disabled').length).toBe(5);
    expect(element().textContent).not.toContain('Paul');
    // Nothing to print or export until the framework exists.
    expect(query('mktg-framework-view-actions')).toBeNull();
    expect(query('mktg-framework-view-print')).toBeNull();
  });

  it('says it is waiting for answers while the questions are projected in', async () => {
    host.state.set('questions');
    await fixture.whenStable();

    expect(query('mktg-framework-view-state')?.textContent).toContain('Waiting for your answers');
    expect(query('mktg-framework-view-generating')).not.toBeNull();
  });

  it('anchors each framework section to its original JSON index without adding comments to report fields', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    await fixture.whenStable();
    expect(query('mktg-framework-view')?.className).toContain('[@media_screen]:@container/asset');
    expect(query('mktg-framework-view')?.className).not.toContain('@container/framework');
    expect(query('mktg-framework-view-panel-framework')?.firstElementChild?.className).toContain('@lg/asset:grid-cols-2');
    const has = (field: string) => element().querySelector(`[data-mktg-comment-field="${field}"]`);
    const keys = new Set<string>();
    const collect = () =>
      element()
        .querySelectorAll('[data-mktg-comment-field]')
        .forEach((node) => keys.add(node.getAttribute('data-mktg-comment-field') ?? ''));
    collect();
    for (const field of [
      'mf.vision',
      'mf.mission',
      'mf.positioning',
      'mf.tagline',
      'mf.goals[0]',
      'mf.goals[1]',
      'mf.goals[1].bite',
      'mf.goals[0].vp',
      'mf.say',
      'mf.avoid',
      'mf.anchor',
    ])
      expect(has(field)).not.toBeNull();
    await tab('icps');
    collect();
    expect(query('mktg-framework-view-panel-icps')?.className).toContain('@4xl/asset:grid-cols-2');
    expect(has('icp[0]')).not.toBeNull();
    expect(has('icp[1]')).not.toBeNull();
    expect(has('icp[0].cta')).not.toBeNull();
    await tab('message-house');
    collect();
    expect(query('mktg-framework-view-pillars')?.className).toContain('@2xl/asset:grid-cols-3');
    for (const field of ['mh.umbrella', 'mh.line', 'mh.pillars[0]', 'mh.pillars[0].m', 'mh.found', 'mh.aud']) expect(has(field)).not.toBeNull();
    await tab('numbers');
    collect();
    expect(query('mktg-framework-view-panel-numbers')?.className).toContain('@2xl/asset:grid-cols-4');
    expect(has('nums[0]')).not.toBeNull();
    await tab('sources');
    expect(element().querySelector('[data-mktg-comment-field]')).toBeNull();
    expect(keys.size).toBeGreaterThan(20);
    for (const key of keys) expect(isMktgDocumentCommentAnchor('foundation-message', ASSET.content, { kind: 'field', key })).toBe(true);
  });

  it('renders the framework tab first once ready: the statements, the goal columns with their segments, say and avoid', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    host.version.set(1);
    await fixture.whenStable();

    expect(query('mktg-framework-view-generating')).toBeNull();
    expect(query('mktg-framework-view-state')).toBeNull();
    expect(query('mktg-framework-view-version')?.textContent).toContain('v1');
    expect(query('mktg-framework-view-approval-state')?.textContent?.trim()).toBe('Draft');
    expect(query('mktg-framework-view-mode')).toBeNull();
    expect(query('mktg-framework-view-vision')?.textContent).toContain('A vision.');
    expect(query('mktg-framework-view-tagline')?.textContent).toContain('Release, open.');
    const adoption = query('mktg-framework-view-goal-adoption');
    expect(adoption?.textContent).toContain('Goal 1');
    expect(adoption?.textContent).toContain('1,200 members');
    expect(adoption?.textContent).toContain('Website');
    expect(adoption?.textContent).toContain('End users');
    expect(query('mktg-framework-view-bite-community')?.textContent).toContain('Built together');
    expect(query('mktg-framework-view-say')?.textContent).toContain('community-governed');
    expect(query('mktg-framework-view-avoid')?.textContent).toContain('working together');
    expect(query('mktg-framework-view-notes')?.textContent).toContain('Check the member count.');
    expect(element().querySelectorAll<HTMLButtonElement>('[role="tab"]:disabled').length).toBe(0);
  });

  it('switches between the ICPs, the message house, the key numbers and the sources and gaps', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    await fixture.whenStable();

    await tab('icps');
    expect(query('mktg-framework-view-icp-users')?.textContent).toContain('Engineers running releases.');
    expect(query('mktg-framework-view-icp-lead-users')?.textContent).toContain('Ship with confidence.');
    expect(query('mktg-framework-view-icp-users')?.textContent).toContain('Adoption');
    expect(query('mktg-framework-view-icp-users')?.textContent).toContain('Adopters are in production.');
    expect(query('mktg-framework-view-icp-contributors')?.textContent).toContain('Hard to start?');

    await tab('message-house');
    expect(query('mktg-framework-view-umbrella')?.textContent).toContain('Open releases for everyone.');
    expect(query('mktg-framework-view-pillars')?.querySelectorAll('article').length).toBe(3);
    expect(query('mktg-framework-view-found')?.textContent).toContain('A Linux Foundation project.');
    expect(query('mktg-framework-view-audiences')?.textContent).toContain('Build it with us.');

    await tab('numbers');
    expect(query('mktg-framework-view-panel-numbers')?.textContent).toContain('1,200');
    expect(query('mktg-framework-view-panel-numbers')?.textContent).toContain('releases a year');

    await tab('sources');
    expect(query('mktg-framework-view-sources-read')?.textContent).toContain('testorbit.example.org');
    expect(query('mktg-framework-view-sources-failed')?.textContent).toContain('404');
    expect(query('mktg-framework-view-gaps')?.textContent).toContain('No member count.');
    expect(query('mktg-framework-view-report-notes')?.textContent).toContain('Check the dates.');
    expect(query('mktg-framework-view-findings')?.textContent).toContain('nums has 2 numbers');
    expect(query('mktg-framework-view-tab-sources')?.getAttribute('aria-selected')).toBe('true');
  });

  it('moves between the tabs with the arrow keys, Home and End, wrapping round, and focuses the tab it lands on', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    await fixture.whenStable();
    const tablist = query('mktg-framework-view-tabs') as HTMLElement;
    const press = async (key: string): Promise<void> => {
      tablist.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await fixture.whenStable();
    };
    const selected = (): string | null => element().querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.id ?? null;

    // Only the selected tab is in the tab order; the keys move the selection along.
    expect(query('mktg-framework-view-tab-framework')?.getAttribute('tabindex')).toBe('0');
    expect(query('mktg-framework-view-tab-icps')?.getAttribute('tabindex')).toBe('-1');

    await press('ArrowRight');
    expect(selected()).toBe('mktg-framework-tab-icps');
    expect(query('mktg-framework-view-panel-icps')).not.toBeNull();
    expect(document.activeElement?.id).toBe('mktg-framework-tab-icps');
    expect(query('mktg-framework-view-tab-icps')?.getAttribute('tabindex')).toBe('0');

    await press('End');
    expect(selected()).toBe('mktg-framework-tab-sources');
    await press('ArrowRight');
    expect(selected()).toBe('mktg-framework-tab-framework');
    await press('ArrowLeft');
    expect(selected()).toBe('mktg-framework-tab-sources');
    await press('Home');
    expect(selected()).toBe('mktg-framework-tab-framework');
    expect(document.activeElement?.id).toBe('mktg-framework-tab-framework');

    // Any other key is left alone.
    await press('Enter');
    expect(selected()).toBe('mktg-framework-tab-framework');
  });

  it('says so under each empty part: nothing to avoid, nothing read, no failed source, no gap, nothing to check', async () => {
    host.asset.set({
      ...ASSET,
      content: { ...ASSET.content, mf: { ...ASSET.content.mf, avoid: [] } },
      report: { sources_read: [], sources_failed: [], gaps: [], notes: '' },
      checks: { findings: [] },
    });
    host.state.set('ready');
    await fixture.whenStable();

    expect(query('mktg-framework-view-avoid-empty')?.textContent).toContain('Nothing to avoid was stated.');
    expect(query('mktg-framework-view-avoid')).toBeNull();

    await tab('sources');
    expect(query('mktg-framework-view-sources-read')).toBeNull();
    expect(query('mktg-framework-view-sources-read-empty')?.textContent).toContain('Nothing was read.');
    expect(query('mktg-framework-view-sources-failed')).toBeNull();
    expect(query('mktg-framework-view-sources-failed-empty')?.textContent).toContain('Every source was read.');
    expect(query('mktg-framework-view-gaps')).toBeNull();
    expect(query('mktg-framework-view-gaps-empty')?.textContent).toContain('The sources left no gap.');
    expect(query('mktg-framework-view-report-notes')).toBeNull();
    expect(query('mktg-framework-view-findings')).toBeNull();
    expect(query('mktg-framework-view-checks-empty')?.textContent).toContain('Nothing to check.');
  });

  it('prints the framework’s tabs as one document in the LF look — the report and the reviewer’s note left out — with Download PDF', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    host.version.set(3);
    host.approvedAsset.set(ASSET);
    host.approvedVersion.set(3);
    await fixture.whenStable();

    const wrapper = query('mktg-framework-view-print');
    expect(wrapper?.className).toContain('lfx-framework-print-only');
    const print = query('mktg-framework-print');
    expect(print?.getAttribute('data-brand')).toBe('lf');
    expect(query('mktg-framework-print-title')?.textContent).toContain('Messaging Framework');
    expect(query('mktg-framework-print-tagline')?.textContent).toContain('Release, open.');
    expect(query('mktg-framework-print-version')?.textContent).toContain('Version 3');
    expect(query('mktg-framework-print-cover-logo')?.getAttribute('src')).toBe('/images/logo_lf_white.svg');
    expect(query('mktg-framework-print-contents')?.textContent).toContain('Key numbers');
    expect(query('mktg-framework-print-contents')?.textContent).not.toContain('Sources and gaps');
    expect(query('mktg-framework-print-goals')?.querySelectorAll('article').length).toBe(2);
    expect(query('mktg-framework-print-icp-contributors')?.textContent).toContain('Build it with us.');
    expect(query('mktg-framework-print-pillars')?.querySelectorAll('article').length).toBe(3);
    expect(query('mktg-framework-print-numbers')?.textContent).toContain('releases a year');
    expect(print?.textContent).not.toContain('No member count.');
    expect(print?.textContent).not.toContain('Check the member count.');
    expect(print?.textContent).not.toContain('Check the dates.');

    // Export to Google Slides waits for the page to name a stored revision.
    expect(query('mktg-framework-view-export-slides')?.querySelector('button')?.disabled).toBe(true);
    query('mktg-framework-view-download-pdf')?.querySelector('button')?.click();
    expect(printer.print).toHaveBeenCalledWith(FOUNDATION_MESSAGE_PRINT_BODY_CLASS, null);

    fixture.destroy();
    expect(printer.clear).toHaveBeenCalledWith(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
  });

  it('prints approved current bytes/version independently of the newer viewed Draft', async () => {
    host.asset.set({ ...ASSET, content: { ...ASSET.content, mf: { ...ASSET.content.mf, tagline: 'New draft only' } } });
    host.state.set('ready');
    host.version.set(3);
    host.approvedAsset.set(ASSET);
    host.approvedVersion.set(1);
    await fixture.whenStable();
    expect(query('mktg-framework-view-version')?.textContent).toContain('v3');
    expect(query('mktg-framework-print-version')?.textContent).toContain('Version 1');
    expect(query('mktg-framework-print-tagline')?.textContent).toContain('Release, open.');
    expect(query('mktg-framework-print')?.textContent).not.toContain('New draft only');
  });

  it('does not create a print target or invoke the printer without approved current', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    await fixture.whenStable();
    expect(query('mktg-framework-view-download-pdf')?.querySelector('button')?.disabled).toBe(true);
    expect(query('mktg-framework-view-print')).toBeNull();
    query('mktg-framework-view-download-pdf')?.querySelector('button')?.click();
    expect(printer.print).not.toHaveBeenCalled();
  });

  it('exports the stored framework to Google Slides, the panel under the header showing the progress', async () => {
    const target: MktgSlidesExportTarget = { project: 'proj-1', agentKey: 'foundation-message', documentId: 'living', contentSha256: 'a'.repeat(64) };
    const kit = brandKitTestRevision();
    host.asset.set(ASSET);
    host.state.set('ready');
    host.kit.set(kit);
    host.exportTarget.set(target);
    await fixture.whenStable();

    expect(slidesExport.last).toHaveBeenCalledWith(target);
    query('mktg-framework-view-export-slides')?.querySelector('button')?.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(slidesExport.start).toHaveBeenCalledWith({ ...target, mode: 'create' });
    expect(query('mktg-slides-export-running')?.textContent).toContain('Exporting the messaging framework');
    expect(query('mktg-framework-view-export-slides')?.querySelector('button')?.disabled).toBe(true);
  });

  it('sets the print in the project’s Brand Kit when there is one: its colours, its typeface (waited for before the dialog), its logo', async () => {
    const kit = brandKitTestRevision();
    host.asset.set(ASSET);
    host.state.set('ready');
    host.kit.set(kit);
    host.approvedAsset.set(ASSET);
    host.approvedVersion.set(1);
    await fixture.whenStable();

    const print = query('mktg-framework-print') as HTMLElement;
    expect(print.getAttribute('data-brand')).toBe('kit');
    expect(print.style.getPropertyValue('--mfp-dark')).toBe(kit.kit.dark);
    expect(print.style.getPropertyValue('--mfp-accent')).toBe(kit.kit.accent);
    expect(print.style.getPropertyValue('--mfp-font')).toContain('Montserrat');
    // No reversed artwork in the kit: the cover draws the primary lockup white.
    expect(query('mktg-framework-print-cover-logo')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(query('mktg-framework-print-cover-logo')?.style.filter).toContain('invert');

    query('mktg-framework-view-download-pdf')?.querySelector('button')?.click();
    expect(printer.print).toHaveBeenCalledWith(FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'Montserrat');
  });

  it('opens Sources from the reviewer note and focuses its panel start', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    await fixture.whenStable();
    document.body.appendChild(element());

    query('mktg-framework-view-notes-sources')?.click();
    await fixture.whenStable();
    expect(query('mktg-framework-view-panel-sources')).not.toBeNull();
    expect(document.activeElement).toBe(query('mktg-framework-view-panel-sources'));
    element().remove();
  });
});
