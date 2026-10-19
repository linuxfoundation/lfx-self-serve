// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MktgFrameworkAsset, MktgFrameworkViewState } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MktgFrameworkViewComponent } from './mktg-framework-view.component';

/** A host that projects the feed or the questions into the view, as the run page does. */
@Component({
  selector: 'lfx-test-framework-host',
  imports: [MktgFrameworkViewComponent],
  template: `
    <lfx-mktg-framework-view projectName="TestOrbit" [asset]="asset()" [state]="state()" [version]="version()">
      <p data-testid="projected">The feed goes here</p>
    </lfx-mktg-framework-view>
  `,
})
class HostComponent {
  public readonly asset = signal<MktgFrameworkAsset | null>(null);
  public readonly state = signal<MktgFrameworkViewState>('generating');
  public readonly version = signal<number | null>(null);
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

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null => element().querySelector(`[data-testid="${testId}"]`);
  const tab = async (id: string): Promise<void> => {
    query(`mktg-framework-view-tab-${id}`)?.click();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('shows the generating state with the projected feed where the framework will be, tabs disabled', () => {
    expect(query('mktg-framework-view-title')?.textContent).toContain('TestOrbit Messaging framework');
    expect(query('mktg-framework-view-state')?.textContent).toContain('Generating');
    expect(query('mktg-framework-view-generating')?.textContent).toContain('The feed goes here');
    expect(query('mktg-framework-view-panel-framework')).toBeNull();
    expect(element().querySelectorAll<HTMLButtonElement>('[role="tab"]').length).toBe(5);
    expect(element().querySelectorAll<HTMLButtonElement>('[role="tab"]:disabled').length).toBe(5);
    expect(element().textContent).not.toContain('Paul');
  });

  it('says it is waiting for answers while the questions are projected in', async () => {
    host.state.set('questions');
    await fixture.whenStable();

    expect(query('mktg-framework-view-state')?.textContent).toContain('Waiting for your answers');
    expect(query('mktg-framework-view-generating')).not.toBeNull();
  });

  it('renders the framework tab first once ready: the statements, the goal columns with their segments, say and avoid', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    host.version.set(1);
    await fixture.whenStable();

    expect(query('mktg-framework-view-generating')).toBeNull();
    expect(query('mktg-framework-view-state')).toBeNull();
    expect(query('mktg-framework-view-version')?.textContent).toContain('v1');
    expect(query('mktg-framework-view-mode')?.textContent).toContain('Draft');
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

  it('opens the Sources tab from the reviewer note and moves keyboard focus onto that tab', async () => {
    host.asset.set(ASSET);
    host.state.set('ready');
    await fixture.whenStable();
    document.body.appendChild(element());

    query('mktg-framework-view-notes-sources')?.click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));

    expect(query('mktg-framework-view-panel-sources')).not.toBeNull();
    expect(document.activeElement).toBe(query('mktg-framework-view-tab-sources'));
    element().remove();
  });
});
