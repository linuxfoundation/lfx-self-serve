// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input, TemplateRef } from '@angular/core';
import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiModalComponent } from '../modal/modal.component';
import { UiModalService } from '../modal/modal.service';
import { UiOptionComponent } from '../select/option.component';
import { UiSelectComponent } from '../select/select.component';
import { UiToggleComponent } from '../toggle/toggle.component';
import { UiPopoverPanelComponent } from './popover-panel.component';
import { UiPopoverDirective } from './popover.directive';

/** Story helper: opens the template it is bound to through `UiModalService` when the host is clicked. */
@Directive({ selector: '[lfxStoryOpensModal]', host: { '(click)': 'open()' } })
class StoryOpensModalDirective {
  public readonly lfxStoryOpensModal = input.required<TemplateRef<unknown>>();

  private readonly modal = inject(UiModalService);

  protected open(): void {
    this.modal.open(this.lfxStoryOpensModal());
  }
}

const meta: Meta<UiPopoverDirective> = {
  title: 'Uikit/Popover',
  component: UiPopoverDirective,
  subcomponents: { UiPopoverPanelComponent },
  decorators: [
    moduleMetadata({
      imports: [
        UiPopoverDirective,
        UiButtonComponent,
        UiSelectComponent,
        UiOptionComponent,
        UiToggleComponent,
        UiMenuComponent,
        UiMenuItemComponent,
        UiModalComponent,
        StoryOpensModalDirective,
      ],
    }),
  ],
  args: { label: '', width: null, padding: 'default', open: false },
  render: (args) => ({
    // Storybook copies props onto the directive instance, so nest them to keep the signal inputs intact.
    props: { cfg: args },
    template: `
      <div class="flex min-h-[320px] justify-center pt-[48px]">
        <lfx-ui-button variant="secondary" icon="fa-light fa-circle-info" [popover]="info" [popoverLabel]="cfg.label" [popoverWidth]="cfg.width" [popoverPadding]="cfg.padding">Details</lfx-ui-button>
        <ng-template #info>
          <div class="flex flex-col gap-[8px]">
            <p class="label-14 text-ui-neutral-900">Release cadence</p>
            <p class="copy-14 text-ui-neutral-600">Releases ship every six weeks. Patch releases follow within two weeks of a regression report.</p>
          </div>
        </ng-template>
      </div>`,
  }),
};
export default meta;
type Story = StoryObj<UiPopoverDirective>;

/** Plain content on an `lfx-ui-button`. The panel is as wide as its content. Open it, then Escape or click away: focus returns to the button. */
export const Default: Story = {};

/** The panel pads its content by 16px. `padding="none"` lets content run edge to edge, such as a list that pads its own rows. */
export const NoPadding: Story = {
  args: { padding: 'none' },
  render: (args) => ({
    props: { cfg: args },
    template: `
      <div class="flex min-h-[320px] justify-center pt-[48px]">
        <lfx-ui-button variant="secondary" icon="fa-light fa-bell" [popover]="inbox" [popoverPadding]="cfg.padding" [popoverWidth]="280">Inbox</lfx-ui-button>
        <ng-template #inbox>
          <ul class="m-0 list-none divide-y divide-ui-neutral-alpha-200 p-0">
            <li class="px-[16px] py-[12px] label-14 text-ui-neutral-900">Budget review moved to Friday</li>
            <li class="px-[16px] py-[12px] label-14 text-ui-neutral-900">Two votes need your response</li>
            <li class="px-[16px] py-[12px] label-14 text-ui-neutral-900">New member joined the TOC</li>
          </ul>
        </ng-template>
      </div>`,
  }),
};

/** A fixed width in px with a name for the dialog. Without `label` the button names the dialog. */
export const FixedWidth: Story = { args: { width: 240, label: 'Release cadence' } };

/** The meetings Filters panel: selects and switches in a 300px panel, Reset and Done in the footer. The template receives `close`. */
export const FiltersPanel: Story = {
  render: () => ({
    template: `
      <div class="flex min-h-[520px] justify-start pt-[48px]">
        <lfx-ui-button variant="secondary" size="small" icon="fa-light fa-sliders" [popover]="filters" popoverLabel="Meeting filters" [popoverWidth]="300">Filters</lfx-ui-button>
        <ng-template #filters let-close="close">
          <div class="flex flex-col gap-[16px]" data-testid="story-filters">
            <lfx-ui-select label="Project" size="small" value="all">
              <lfx-ui-option value="all" label="All projects" />
              <lfx-ui-option value="cncf" label="CNCF" />
              <lfx-ui-option value="openssf" label="OpenSSF" />
            </lfx-ui-select>
            <lfx-ui-select label="Meeting type" size="small" value="all">
              <lfx-ui-option value="all" label="All types" />
              <lfx-ui-option value="committee" label="Committee" />
              <lfx-ui-option value="board" label="Board" />
            </lfx-ui-select>
            <lfx-ui-select label="RSVP" size="small" value="any">
              <lfx-ui-option value="any" label="Any RSVP" />
              <lfx-ui-option value="needs" label="Needs response" />
              <lfx-ui-option value="going" label="Going" />
              <lfx-ui-option value="maybe" label="Maybe" />
              <lfx-ui-option value="not-going" label="Not going" />
            </lfx-ui-select>
            <lfx-ui-toggle label="Organized by me" />
            <lfx-ui-toggle label="Hide declined meeting series" />
            <div class="flex items-center justify-between pt-[4px]">
              <lfx-ui-button variant="tertiary" size="small" icon="fa-light fa-rotate-left" (click)="close()">Reset filters</lfx-ui-button>
              <lfx-ui-button size="small" (click)="close()">Done</lfx-ui-button>
            </div>
          </div>
        </ng-template>
      </div>`,
  }),
};

/** At the bottom-right corner there is no room below or to the right, so the panel flips above the button and aligns to its end edge. */
export const FlipsAtTheEdge: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => ({
    template: `
      <div class="flex h-[100vh] items-end justify-end p-[16px]">
        <lfx-ui-button variant="secondary" icon="fa-light fa-circle-info" [popover]="info" [popoverWidth]="280">Details</lfx-ui-button>
        <ng-template #info>
          <p class="copy-14 text-ui-neutral-600">Opened below and to the start edge first; with no room there it opens above, then from the end edge.</p>
        </ng-template>
      </div>`,
  }),
};

/** On a native button the directive is the trigger itself, with `#pop="lfxUiPopover"` to close it from outside the template. */
export const OnNativeButton: Story = {
  render: () => ({
    template: `
      <div class="flex min-h-[240px] justify-center pt-[48px]">
        <button
          type="button"
          class="edge inline-flex h-ui-medium items-center gap-[8px] rounded-ui-sm bg-ui-background-100 px-[16px] button-14 text-ui-neutral-900 focus-visible:shadow-focus focus-visible:outline-none"
          [lfxUiPopover]="share"
          lfxUiPopoverLabel="Share this page">
          <i class="fa-light fa-share-nodes" aria-hidden="true"></i>Share
        </button>
        <ng-template #share let-close="close">
          <div class="flex items-center gap-[8px]">
            <span class="copy-14 text-ui-neutral-600">https://lfx.dev/projects/cncf</span>
            <lfx-ui-button size="small" variant="secondary" icon="fa-light fa-copy" (click)="close()">Copy</lfx-ui-button>
          </div>
        </ng-template>
      </div>`,
  }),
};

/** A menu or a modal opened from the panel. A click inside either keeps the popover open, and Escape closes the menu or modal first, then the popover. */
export const OverlaysInside: Story = {
  render: () => ({
    template: `
      <div class="flex min-h-[420px] justify-center pt-[48px]">
        <lfx-ui-button variant="secondary" icon="fa-light fa-ellipsis" [popover]="panel" popoverLabel="Project settings" [popoverWidth]="280">Settings</lfx-ui-button>
        <ng-template #panel>
          <div class="flex gap-[8px]">
            <lfx-ui-button variant="secondary" size="small" trailingIcon="fa-light fa-chevron-down" [menu]="actions">Actions</lfx-ui-button>
            <lfx-ui-button variant="secondary" size="small" [lfxStoryOpensModal]="dialog">Rename</lfx-ui-button>
          </div>
        </ng-template>
        <ng-template #actions>
          <lfx-ui-menu ariaLabel="Project actions">
            <lfx-ui-menu-item>Edit</lfx-ui-menu-item>
            <lfx-ui-menu-item>Duplicate</lfx-ui-menu-item>
          </lfx-ui-menu>
        </ng-template>
        <ng-template #dialog let-ref="dialogRef">
          <lfx-ui-modal size="sm" heading="Rename project" [singleAction]="true">
            <p class="copy-14 text-ui-neutral-600">Click inside this modal: the popover behind it stays open.</p>
            <ng-container modalActions><lfx-ui-button (click)="ref.close()">Done</lfx-ui-button></ng-container>
          </lfx-ui-modal>
        </ng-template>
      </div>`,
  }),
};
