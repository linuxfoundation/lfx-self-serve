// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser, NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { BOILERPLATES_MODE_LABELS, BOILERPLATES_VIEW_TABS } from '@lfx-one/shared/constants';
import {
  BoilerplatesLengthView,
  BoilerplatesViewTab,
  BoilerplatesViewTabId,
  MktgBoilerplatesAsset,
  MktgRevisionApproval,
  MktgAssetHeaderMetadata,
} from '@lfx-one/shared/interfaces';
import { boilerplatesLengthRows, mktgAssetHeaderFallback } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';

import { createMktgAssetTab } from '../utils/mktg-asset-tab.util';
import { MktgAssetMetaComponent } from '../components/mktg-asset-meta/mktg-asset-meta.component';

// The Boilerplates view: the asset's own app page inside the mktg-os-agents
// module, in the framework view's look (full width, a tab bar, white cards).
// The Boilerplates tab shows the four lengths — the one-liner and the 25, 50
// and 100-word versions — each with its word count against its limit and a
// Copy button; the reviewer's notes and the finalize tool's findings sit
// under them. The Sources and gaps tab shows the run's report. Read only:
// review by comments on each length is a later item. Purely presentational:
// the run page and the Documents area feed it.
@Component({
  selector: 'lfx-mktg-boilerplates-view',
  imports: [NgClass, MktgAssetMetaComponent, ButtonComponent],
  templateUrl: './mktg-boilerplates-view.component.html',
})
export class MktgBoilerplatesViewComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  /** The project the boilerplates are for. */
  public readonly projectName = input.required<string>();
  /** The validated boilerplates with their report and checks. */
  public readonly asset = input.required<MktgBoilerplatesAsset>();
  /** The revision or run version shown in the header, when known. */
  public readonly version = input<number | null>(null);
  public readonly headerMetadata = input<MktgAssetHeaderMetadata | null>(null);
  public readonly showMetadata = input(true);
  public readonly approval = input<MktgRevisionApproval | null>(null);

  // === Signals ===
  private readonly tabState = createMktgAssetTab(
    BOILERPLATES_VIEW_TABS.map((tab) => tab.id),
    'boilerplates'
  );
  protected readonly selectedTab = this.tabState.selected;
  /** The length whose text was just copied — drives the transient "Copied" state. */
  protected readonly copiedIndex = signal<number | null>(null);

  // === Computed ===
  protected readonly title = computed(() => `${this.projectName()} Boilerplates`);
  protected readonly header = computed(() => this.headerMetadata() ?? mktgAssetHeaderFallback('boilerplates', this.version(), null, this.approval()));
  protected readonly modeLabel = computed(() => (this.asset().mode === 'draft' ? '' : BOILERPLATES_MODE_LABELS[this.asset().mode]));
  protected readonly report = computed(() => this.asset().report);
  protected readonly findings = computed(() => this.asset().checks.findings);
  protected readonly rows: Signal<BoilerplatesLengthView[]> = this.initRows();
  /** The report's notes as lines (a check writes one issue per line). */
  protected readonly reportNotes = computed(() =>
    this.report()
      .notes.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
  );
  /** What the reviewer should look at: the gaps and the sources that could not be read. */
  protected readonly gapCount = computed(() => this.report().gaps.length + this.report().sources_failed.length);
  /** Screen-reader copy confirmation for the live region — the visible button flip alone is never announced. */
  protected readonly copiedAnnouncement = computed(() => {
    const index = this.copiedIndex();
    const row = index === null ? undefined : this.rows()[index];
    return row ? `${row.label} boilerplate copied to the clipboard` : '';
  });
  protected readonly tabs: Signal<BoilerplatesViewTab[]> = this.initTabs();

  // Literal class names so Tailwind's content scan generates them (the framework view's tab classes).
  private readonly tabClasses: Record<'selected' | 'idle', string> = {
    selected: 'border-blue-600 text-blue-700',
    idle: 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300',
  };
  // The word-count chip: emerald within the limit, amber over it (a hand edit a check returned, a length a redraft kept).
  private readonly countClasses: Record<'within' | 'over', string> = {
    within: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    over: 'border-amber-200 bg-amber-50 text-amber-700',
  };
  /** Reset timer of the "Copied" state — cleared on destroy. */
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.copyTimer !== null) {
        clearTimeout(this.copyTimer);
        this.copyTimer = null;
      }
    });
  }

  // === Protected methods ===
  protected async onSelectTab(id: BoilerplatesViewTabId): Promise<void> {
    await this.tabState.select(id);
    if (isPlatformBrowser(this.platformId) && !this.destroyRef.destroyed) {
      afterNextRender(
        () => {
          if (this.selectedTab() !== id) return;
          const panel = this.host.nativeElement.querySelector<HTMLElement>('[role="tabpanel"]');
          if (panel) {
            if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
            panel.focus();
          }
        },
        { injector: this.injector }
      );
    }
  }

  /**
   * A shortcut from inside a panel (the reviewer card's "Sources read, failed
   * and gaps") opens that tab and focuses its rendered panel, as on the other
   * asset views: the button that was clicked leaves with the old panel.
   */
  protected onGoToTab(id: BoilerplatesViewTabId): void {
    void this.onSelectTab(id);
  }

  /**
   * Keyboard tabs, as on the framework view: only the selected tab is in the
   * tab order (roving tabindex), so the arrow keys, Home and End move the
   * selection and the focus along the tablist. Other keys pass through.
   */
  protected onTabKeydown(event: KeyboardEvent): void {
    const tabs = this.tabs();
    const current = tabs.findIndex((tab) => tab.selected);
    let next = current;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    void this.tabState.select(tabs[next].id);
    if (isPlatformBrowser(this.platformId)) {
      this.document.getElementById(tabs[next].tabId)?.focus();
    }
  }

  /** Copies one length's text; its button reads "Copied" for a moment. */
  protected async onCopy(row: BoilerplatesLengthView): Promise<void> {
    // SSR guard: navigator/clipboard are browser-only (ssr-safety rule).
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    // A failed copy is said, never left to look like a button that did nothing.
    if (!navigator.clipboard?.writeText) {
      this.messageService.add({ severity: 'error', summary: 'Copy not supported', detail: 'Clipboard access is unavailable in this browser.' });
      return;
    }
    try {
      await navigator.clipboard.writeText(row.text);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Copy failed', detail: `Unable to copy the ${row.label} boilerplate to the clipboard.` });
      return;
    }
    this.copiedIndex.set(row.index);
    if (this.copyTimer !== null) {
      clearTimeout(this.copyTimer);
    }
    this.copyTimer = setTimeout(() => {
      this.copyTimer = null;
      this.copiedIndex.set(null);
    }, 2000);
  }

  // === Private initializers ===
  private initRows(): Signal<BoilerplatesLengthView[]> {
    return computed(() => boilerplatesLengthRows(this.asset()).map((row) => ({ ...row, countClass: this.countClasses[row.over ? 'over' : 'within'] })));
  }

  private initTabs(): Signal<BoilerplatesViewTab[]> {
    return computed(() =>
      BOILERPLATES_VIEW_TABS.map((tab) => {
        const selected = tab.id === this.selectedTab();
        return {
          id: tab.id,
          label: tab.label,
          selected,
          tabClass: this.tabClasses[selected ? 'selected' : 'idle'],
          tabId: `mktg-boilerplates-tab-${tab.id}`,
          panelId: `mktg-boilerplates-panel-${tab.id}`,
        };
      })
    );
  }
}
