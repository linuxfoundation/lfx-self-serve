// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input, TemplateRef } from '@angular/core';
import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiComboboxComponent } from '../combobox/combobox.component';
import { UiMenuItemComponent } from '../menu/menu-item.component';
import { UiMenuComponent } from '../menu/menu.component';
import { UiModalComponent } from '../modal/modal.component';
import { UiModalService } from '../modal/modal.service';
import { UiMultiSelectComponent } from '../multi-select/multi-select.component';
import { UiOptionComponent } from '../select/option.component';
import { UiSelectSlotDirective } from '../select/select-slot.directive';
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
        UiSelectSlotDirective,
        UiMultiSelectComponent,
        UiComboboxComponent,
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
        <lfx-ui-button size="large" variant="secondary" icon="fa-light fa-circle-info" [popover]="info" [popoverLabel]="cfg.label" [popoverWidth]="cfg.width" [popoverPadding]="cfg.padding">Details</lfx-ui-button>
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
        <lfx-ui-button size="large" variant="secondary" icon="fa-light fa-bell" [popover]="inbox" [popoverPadding]="cfg.padding" [popoverWidth]="280">Inbox</lfx-ui-button>
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
        <lfx-ui-button variant="secondary" icon="fa-light fa-sliders" [popover]="filters" popoverLabel="Meeting filters" [popoverWidth]="300">Filters</lfx-ui-button>
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
              <lfx-ui-button variant="tertiary" icon="fa-light fa-rotate-left" (click)="close()">Reset filters</lfx-ui-button>
              <lfx-ui-button (click)="close()">Done</lfx-ui-button>
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
        <lfx-ui-button size="large" variant="secondary" icon="fa-light fa-circle-info" [popover]="info" [popoverWidth]="280">Details</lfx-ui-button>
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
          class="inline-flex h-ui-medium items-center gap-[8px] rounded-ui-sm border border-ui-neutral-alpha-300 bg-ui-background-100 px-[16px] button-14 text-ui-neutral-900 hover:bg-ui-neutral-alpha-50 focus:outline-none focus-visible:shadow-[0_0_0_4px] focus-visible:shadow-ui-accent-100 forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[color:Highlight]"
          [lfxUiPopover]="share"
          lfxUiPopoverLabel="Share this page">
          <i class="fa-light fa-share-nodes" aria-hidden="true"></i>Share
        </button>
        <ng-template #share let-close="close">
          <div class="flex items-center gap-[8px]">
            <span class="copy-14 text-ui-neutral-600">https://lfx.dev/projects/cncf</span>
            <lfx-ui-button variant="secondary" icon="fa-light fa-copy" (click)="close()">Copy</lfx-ui-button>
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
        <lfx-ui-button size="large" variant="secondary" icon="fa-light fa-ellipsis" [popover]="panel" popoverLabel="Project settings" [popoverWidth]="280">Settings</lfx-ui-button>
        <ng-template #panel>
          <div class="flex gap-[8px]">
            <lfx-ui-button variant="secondary" trailingIcon="fa-light fa-chevron-down" [menu]="actions">Actions</lfx-ui-button>
            <lfx-ui-button variant="secondary" [lfxStoryOpensModal]="dialog">Rename</lfx-ui-button>
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

/** Selects with a search field as the first and a middle field. Shift+Tab from either search field stops on its select, list open; Tab from the second one moves on to Done. */
export const SearchSelectsInside: Story = {
  render: () => ({
    props: {
      projectQuery: '',
      ownerQuery: '',
      projects: ['Kubernetes', 'Envoy', 'Sigstore', 'OpenTelemetry'],
      owners: ['Ana Silva', 'Jun Park', 'Priya Nair', 'Tom Weber'],
      matches: (names: string[], query: string) => names.filter((name) => name.toLowerCase().includes(query.toLowerCase())),
    },
    template: `
      <div class="flex min-h-[480px] justify-start pt-[48px]">
        <lfx-ui-button variant="secondary" icon="fa-light fa-sliders" [popover]="filters" popoverLabel="Meeting filters" [popoverWidth]="300">Filters</lfx-ui-button>
        <ng-template #filters let-close="close">
          <div class="flex flex-col gap-[16px]">
            <lfx-ui-select label="Project" size="small" placeholder="Any project" (openChange)="projectQuery = ''; projectSearch.value = ''">
              <input #projectSearch lfxUiSelectHeader type="search" class="h-ui-small w-full rounded-ui-sm bg-ui-neutral-50 px-[10px] label-14 text-ui-neutral-900 outline-none focus-visible:shadow-focus" aria-label="Search projects" placeholder="Search" (input)="projectQuery = $any($event.target).value" />
              @for (project of matches(projects, projectQuery); track project) {
                <lfx-ui-option [value]="project.toLowerCase()" [label]="project" />
              } @empty {
                <p lfxUiSelectEmpty>No projects match “{{ projectQuery }}”.</p>
              }
            </lfx-ui-select>
            <lfx-ui-select label="Organizer" size="small" placeholder="Anyone" (openChange)="ownerQuery = ''; ownerSearch.value = ''">
              <input #ownerSearch lfxUiSelectHeader type="search" class="h-ui-small w-full rounded-ui-sm bg-ui-neutral-50 px-[10px] label-14 text-ui-neutral-900 outline-none focus-visible:shadow-focus" aria-label="Search organizers" placeholder="Search" (input)="ownerQuery = $any($event.target).value" />
              @for (owner of matches(owners, ownerQuery); track owner) {
                <lfx-ui-option [value]="owner" [label]="owner" />
              } @empty {
                <p lfxUiSelectEmpty>No organizers match “{{ ownerQuery }}”.</p>
              }
            </lfx-ui-select>
            <div class="flex justify-end"><lfx-ui-button (click)="close()">Done</lfx-ui-button></div>
          </div>
        </ng-template>
      </div>`,
  }),
};

/** Multi-selects as the first and a middle field. Shift+Tab from either list closes it and stops on its trigger; Tab from the second list moves on to Done. */
export const MultiSelectsInside: Story = {
  render: () => ({
    template: `
      <div class="flex min-h-[480px] justify-start pt-[48px]">
        <lfx-ui-button variant="secondary" icon="fa-light fa-sliders" [popover]="filters" popoverLabel="Meeting filters" [popoverWidth]="300">Filters</lfx-ui-button>
        <ng-template #filters let-close="close">
          <div class="flex flex-col gap-[16px]">
            <lfx-ui-multi-select label="Projects" size="small">
              <lfx-ui-option value="cncf" label="CNCF" />
              <lfx-ui-option value="openssf" label="OpenSSF" />
              <lfx-ui-option value="lfenergy" label="LF Energy" />
            </lfx-ui-multi-select>
            <lfx-ui-multi-select label="Meeting types" size="small">
              <lfx-ui-option value="committee" label="Committee" />
              <lfx-ui-option value="board" label="Board" />
              <lfx-ui-option value="working-group" label="Working group" />
            </lfx-ui-multi-select>
            <div class="flex justify-end"><lfx-ui-button (click)="close()">Done</lfx-ui-button></div>
          </div>
        </ng-template>
      </div>`,
  }),
};

/** A combobox as the last field. Tab from it, list open, closes the list and the panel onto Filters and moves on to Export. */
export const ComboboxLastField: Story = {
  render: () => ({
    template: `
      <div class="flex min-h-[480px] justify-start gap-[8px] pt-[48px]">
        <lfx-ui-button variant="secondary" icon="fa-light fa-sliders" [popover]="filters" popoverLabel="Meeting filters" [popoverWidth]="300">Filters</lfx-ui-button>
        <lfx-ui-button variant="secondary" icon="fa-light fa-download">Export</lfx-ui-button>
        <ng-template #filters>
          <div class="flex flex-col gap-[16px]">
            <lfx-ui-select label="Meeting type" size="small" value="all">
              <lfx-ui-option value="all" label="All types" />
              <lfx-ui-option value="committee" label="Committee" />
              <lfx-ui-option value="board" label="Board" />
            </lfx-ui-select>
            <lfx-ui-combobox label="Project" size="small" placeholder="Search projects" emptyText="No projects match">
              <lfx-ui-option value="k8s" label="Kubernetes" />
              <lfx-ui-option value="envoy" label="Envoy" />
              <lfx-ui-option value="sigstore" label="Sigstore" />
            </lfx-ui-combobox>
          </div>
        </ng-template>
      </div>`,
  }),
};

/** A popover opened from the outer panel's last field. Tab from the inner panel's last field closes both panels onto Filters and moves on to Export. */
export const NestedPopoverLastField: Story = {
  render: () => ({
    template: `
      <div class="flex min-h-[480px] justify-start gap-[8px] pt-[48px]">
        <lfx-ui-button variant="secondary" icon="fa-light fa-sliders" [popover]="filters" popoverLabel="Meeting filters" [popoverWidth]="300">Filters</lfx-ui-button>
        <lfx-ui-button variant="secondary" icon="fa-light fa-download">Export</lfx-ui-button>
        <ng-template #filters>
          <div class="flex flex-col items-start gap-[16px]">
            <lfx-ui-toggle label="Organized by me" />
            <lfx-ui-button variant="secondary" icon="fa-light fa-plus" [popover]="more" popoverLabel="More filters" [popoverWidth]="260">More filters</lfx-ui-button>
          </div>
        </ng-template>
        <ng-template #more let-close="close">
          <div class="flex flex-col gap-[16px]">
            <lfx-ui-toggle label="Hide declined meeting series" />
            <div class="flex justify-end"><lfx-ui-button (click)="close()">Done</lfx-ui-button></div>
          </div>
        </ng-template>
      </div>`,
  }),
};
