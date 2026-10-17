// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal, signal } from '@angular/core';
import { FOUNDATION_MESSAGE_MODE_LABELS, FOUNDATION_MESSAGE_VIEW_TABS } from '@lfx-one/shared/constants';
import {
  FoundationMessageAudienceRow,
  FoundationMessageAvoidRow,
  FoundationMessageGoalView,
  FoundationMessageIcpView,
  FoundationMessageNumberRow,
  FoundationMessagePillarView,
  FoundationMessageViewTab,
  MktgRunAsset,
} from '@lfx-one/shared/interfaces';
import {
  foundationMessageAudienceRows,
  foundationMessageAvoidRows,
  foundationMessageGoalViews,
  foundationMessageIcpViews,
  foundationMessageNumberRows,
  foundationMessagePillarViews,
} from '@lfx-one/shared/utils';

/** Where the view stands: the run is still working (the feed or the questions are projected in), or the framework is on screen. */
export type MktgFrameworkViewState = 'generating' | 'questions' | 'ready';

/** One tab as the template binds it. */
interface TabView {
  id: FoundationMessageViewTab;
  label: string;
  selected: boolean;
  tabClass: string;
  panelId: string;
  tabId: string;
}

// The Messaging Framework asset view (design: Agent run, Asset view): the
// framework's own page inside the mktg-os-agents module, with one tab per
// part of the bundle — the framework (vision, mission, positioning, tagline,
// the goal columns, say and avoid), the ICPs, the message house, the key
// numbers, and the sources and gaps of the run's report. While a run is live
// the same shell shows the generating state and projects the feed or the
// questions where the framework will be, so the run lands here and stays
// here. Purely presentational: the run page and the Documents area feed it.
@Component({
  selector: 'lfx-mktg-framework-view',
  imports: [NgClass],
  templateUrl: './mktg-framework-view.component.html',
})
export class MktgFrameworkViewComponent {
  // === Inputs ===
  /** The project the framework is for. */
  public readonly projectName = input.required<string>();
  /** The validated framework with its report and checks; null while the run is live. */
  public readonly asset = input<MktgRunAsset | null>(null);
  /** Generating (the feed is projected in), questions (the stepper is projected in), or ready. */
  public readonly state = input<MktgFrameworkViewState>('ready');
  /** The revision or run version shown in the header, when known. */
  public readonly version = input<number | null>(null);
  /** A note beside the version — the revision's standing in Documents ("latest"), or nothing. */
  public readonly note = input('');

  // === Signals ===
  protected readonly selectedTab = signal<FoundationMessageViewTab>('framework');

  // === Computed ===
  protected readonly content = computed(() => this.asset()?.content ?? null);
  protected readonly report = computed(() => this.asset()?.report ?? null);
  protected readonly findings = computed(() => this.asset()?.checks.findings ?? []);
  protected readonly ready = computed(() => this.state() === 'ready' && this.content() !== null);
  protected readonly title = computed(() => `${this.projectName()} Messaging framework`);
  protected readonly modeLabel = computed(() => {
    const asset = this.asset();
    return asset ? FOUNDATION_MESSAGE_MODE_LABELS[asset.mode] : '';
  });
  protected readonly stateLabel = computed(() => {
    if (this.state() === 'generating') {
      return 'Generating';
    }
    if (this.state() === 'questions') {
      return 'Waiting for your answers';
    }
    return '';
  });
  protected readonly tabs: Signal<TabView[]> = this.initTabs();
  protected readonly goals: Signal<FoundationMessageGoalView[]> = computed(() => {
    const content = this.content();
    return content ? foundationMessageGoalViews(content) : [];
  });
  protected readonly icps: Signal<FoundationMessageIcpView[]> = computed(() => {
    const content = this.content();
    return content ? foundationMessageIcpViews(content) : [];
  });
  protected readonly pillars: Signal<FoundationMessagePillarView[]> = computed(() => {
    const content = this.content();
    return content ? foundationMessagePillarViews(content) : [];
  });
  protected readonly avoidRows: Signal<FoundationMessageAvoidRow[]> = computed(() => {
    const content = this.content();
    return content ? foundationMessageAvoidRows(content) : [];
  });
  protected readonly numbers: Signal<FoundationMessageNumberRow[]> = computed(() => {
    const content = this.content();
    return content ? foundationMessageNumberRows(content) : [];
  });
  protected readonly audiences: Signal<FoundationMessageAudienceRow[]> = computed(() => {
    const content = this.content();
    return content ? foundationMessageAudienceRows(content) : [];
  });
  /** The report's notes as lines (a check writes one issue per line). */
  protected readonly reportNotes = computed(() =>
    (this.report()?.notes ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
  );

  // Literal class names so Tailwind's content scan generates them.
  private readonly tabClasses: Record<'selected' | 'idle', string> = {
    selected: 'border-blue-600 text-blue-700',
    idle: 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300',
  };

  // === Protected methods ===
  protected onSelectTab(id: FoundationMessageViewTab): void {
    this.selectedTab.set(id);
  }

  // === Private initializers ===
  private initTabs(): Signal<TabView[]> {
    return computed(() =>
      FOUNDATION_MESSAGE_VIEW_TABS.map((tab) => {
        const selected = tab.id === this.selectedTab();
        return {
          id: tab.id,
          label: tab.label,
          selected,
          tabClass: this.tabClasses[selected ? 'selected' : 'idle'],
          tabId: `mktg-framework-tab-${tab.id}`,
          panelId: `mktg-framework-panel-${tab.id}`,
        };
      })
    );
  }
}
