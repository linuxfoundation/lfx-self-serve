// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { describe, expect, it } from 'vitest';

import type { EventsSplitView, MarketingImpactFocusProgram } from '@lfx-one/shared/interfaces';

import { OverviewTabComponent } from './components/overview-tab/overview-tab.component';
import { MarketingImpactComponent } from './marketing-impact.component';

/**
 * Covers the parent-side wiring of the Events attendance/sponsorship split, which the child specs
 * cannot see: they set `eventsSplit` directly, so a regression that hid the tablist or stopped the
 * selection reaching OverviewTabComponent would leave every one of them green while the feature is
 * unreachable in the app.
 */
@Component({ selector: 'lfx-overview-tab', standalone: true, template: '' })
class StubOverviewTabComponent {
  public readonly foundationSlug = input<string | undefined>();
  public readonly foundationName = input<string>('');
  public readonly selectedPeriod = input<string>('');
  public readonly focusProgram = input<MarketingImpactFocusProgram>('all');
  public readonly eventsSplit = input<EventsSplitView | null>(null);
}

describe('MarketingImpactComponent — events split wiring', () => {
  let fixture: ComponentFixture<MarketingImpactComponent>;

  async function render(): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MarketingImpactComponent],
      providers: [
        {
          provide: ProjectContextService,
          useValue: { selectedFoundation: signal({ uid: 'f1', name: 'The Linux Foundation', slug: 'tlf' }) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('executive-director') } },
      ],
    })
      // The real children each fire their own analytics reads; this spec is about the parent's
      // wiring, so only the one that receives the split is stubbed and inspected.
      .overrideComponent(MarketingImpactComponent, {
        remove: { imports: [OverviewTabComponent] },
        add: { imports: [StubOverviewTabComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MarketingImpactComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function tablist(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="events-split-tabs"]');
  }

  function overviewSplit(): EventsSplitView | null {
    const el = fixture.debugElement.children.length ? fixture.debugElement.query((d) => d.componentInstance instanceof StubOverviewTabComponent) : null;
    return el ? (el.componentInstance as StubOverviewTabComponent).eventsSplit() : null;
  }

  async function selectFocus(focus: MarketingImpactFocusProgram): Promise<void> {
    fixture.componentInstance['onFocusChange'](focus);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('hides the split tablist until the Events campaign type is selected', async () => {
    await render();

    expect(tablist()).toBeNull();

    await selectFocus('lfEvents');

    expect(tablist()).toBeTruthy();
  });

  it('passes the selected split through to the overview tab', async () => {
    await render();
    await selectFocus('lfEvents');

    // Defaults to attendance, so the sponsorship half is only reachable via the control.
    expect(overviewSplit()).toBe('attendance');

    (fixture.nativeElement.querySelector('[data-testid="events-split-tab-sponsorship"]') as HTMLElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(overviewSplit()).toBe('sponsorship');
  });

  // The roving tabindex removes the inactive tab from the tab order, so without arrow-key handling
  // a keyboard-only user cannot reach Sponsorship at all.
  it('moves the selection with the arrow keys', async () => {
    await render();
    await selectFocus('lfEvents');

    tablist()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(overviewSplit()).toBe('sponsorship');

    tablist()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(overviewSplit()).toBe('attendance');
  });

  // Leaving Events discards the sub-view, so returning opens on attendance rather than resuming a
  // sponsorship view the user can no longer see.
  it('resets to attendance when the campaign type changes away from Events', async () => {
    await render();
    await selectFocus('lfEvents');

    (fixture.nativeElement.querySelector('[data-testid="events-split-tab-sponsorship"]') as HTMLElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(overviewSplit()).toBe('sponsorship');

    await selectFocus('all');
    await selectFocus('lfEvents');

    expect(overviewSplit()).toBe('attendance');
  });
});
