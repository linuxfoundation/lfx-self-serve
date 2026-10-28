// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, input, PLATFORM_ID, Signal } from '@angular/core';
import { FAQ_MODE_LABELS, FAQ_NEEDS_ANSWER_LABEL, FAQ_VIEW_TABS } from '@lfx-one/shared/constants';
import { FaqGroupView, FaqViewTab, MktgFaqAsset, MktgFaqViewTab, MktgAssetHeaderMetadata, MktgRevisionApproval } from '@lfx-one/shared/interfaces';
import { faqGroupViews, mktgAssetHeaderFallback } from '@lfx-one/shared/utils';
import { createMktgAssetTab } from '../utils/mktg-asset-tab.util';
import { MktgAssetMetaComponent } from '../components/mktg-asset-meta/mktg-asset-meta.component';
import { MktgFieldCommentsComponent } from '../components/mktg-field-comments/mktg-field-comments.component';

// The FAQ asset view, an app page in the Messaging Framework view's look
// (full width, a tab bar, white cards, the version chip): the FAQ itself —
// one card per group, each question with its answer and the source it names,
// or flagged as needing an answer from the team — then the questions the
// sources left unanswered (`checks.unanswered`), then the run's sources and
// gaps. Purely presentational: the run page and the Documents area feed it.
@Component({
  selector: 'lfx-mktg-faq-view',
  imports: [NgClass, MktgAssetMetaComponent, MktgFieldCommentsComponent],
  templateUrl: './mktg-faq-view.component.html',
})
export class MktgFaqViewComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // === Inputs ===
  /** The project the FAQ is for. */
  public readonly projectName = input.required<string>();
  /** The validated FAQ with its report and checks. */
  public readonly asset = input.required<MktgFaqAsset>();
  /** The revision or run version shown in the header, when known. */
  public readonly version = input<number | null>(null);
  public readonly headerMetadata = input<MktgAssetHeaderMetadata | null>(null);
  public readonly showMetadata = input(true);
  /** Only the authorized stored-document host enables comments. */
  public readonly commentsEnabled = input(false);
  public readonly approval = input<MktgRevisionApproval | null>(null);
  /** A note beside the version — the revision's standing in Documents ("latest"), or nothing. */
  public readonly note = input('');

  // === Signals ===
  private readonly tabState = createMktgAssetTab(
    FAQ_VIEW_TABS.map((tab) => tab.id),
    'faq'
  );
  protected readonly selectedTab = this.tabState.selected;

  // === Computed ===
  protected readonly title = computed(() => `${this.projectName()} FAQ`);
  protected readonly header = computed(() => this.headerMetadata() ?? mktgAssetHeaderFallback('faq', this.version(), null, this.approval()));
  protected readonly modeLabel = computed(() => (this.asset().mode === 'draft' ? '' : (FAQ_MODE_LABELS[this.asset().mode] ?? '')));
  protected readonly groups: Signal<FaqGroupView[]> = computed(() => faqGroupViews(this.asset().content));
  protected readonly questionCount = computed(() => this.groups().reduce((total, group) => total + group.questions.length, 0));
  /** What the header says about the FAQ's size. */
  protected readonly sizeLabel = computed(() => {
    const questions = this.questionCount();
    const groups = this.groups().length;
    return `${questions} ${questions === 1 ? 'question' : 'questions'} in ${groups} ${groups === 1 ? 'group' : 'groups'}`;
  });
  /** The questions the sources did not answer, as the agent flagged them for the reviewer. */
  protected readonly unanswered = computed(() => this.asset().checks.unanswered);
  protected readonly unansweredLabel = computed(() => {
    const count = this.unanswered().length;
    return count === 1 ? '1 question needs an answer from your team' : `${count} questions need an answer from your team`;
  });
  protected readonly report = computed(() => this.asset().report);
  protected readonly findings = computed(() => this.asset().checks.findings);
  /** The report's notes as lines (a check writes one issue per line). */
  protected readonly reportNotes = computed(() =>
    this.report()
      .notes.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
  );
  protected readonly tabs: Signal<MktgFaqViewTab[]> = this.initTabs();
  protected readonly needsAnswerLabel = FAQ_NEEDS_ANSWER_LABEL;

  // Literal class names so Tailwind's content scan generates them (the framework view's tab classes).
  private readonly tabClasses: Record<'selected' | 'idle', string> = {
    selected: 'border-blue-600 text-blue-700',
    idle: 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300',
  };

  // === Protected methods ===
  protected async onSelectTab(id: FaqViewTab): Promise<void> {
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
   * A shortcut into a tab from outside the tablist (the header's "need an
   * answer" chip, the FAQ tab's callout): the button that was clicked may go
   * with the panel it sat in, so focus moves to the new panel's start once it
   * has rendered. afterNextRender is bound to this component's injector, so
   * the hook is dropped with the component and never fires after it is gone.
   */
  protected onGoToTab(id: FaqViewTab): void {
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
      document.getElementById(tabs[next].tabId)?.focus();
    }
  }

  // === Private initializers ===
  private initTabs(): Signal<MktgFaqViewTab[]> {
    return computed(() => {
      const unanswered = this.unanswered().length;
      return FAQ_VIEW_TABS.map((tab) => {
        const selected = tab.id === this.selectedTab();
        return {
          id: tab.id,
          // The unanswered questions are counted on their tab, so the reviewer sees them from any tab.
          label: tab.id === 'unanswered' && unanswered > 0 ? `${tab.label} (${unanswered})` : tab.label,
          selected,
          tabClass: this.tabClasses[selected ? 'selected' : 'idle'],
          tabId: `mktg-faq-tab-${tab.id}`,
          panelId: `mktg-faq-panel-${tab.id}`,
        };
      });
    });
  }
}
