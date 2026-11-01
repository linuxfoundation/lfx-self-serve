// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { argsToTemplate, type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiChipGroupComponent } from './chip-group.component';
import { UiChipComponent } from './chip.component';

const meta: Meta<UiChipComponent> = {
  title: 'Uikit/Chip',
  component: UiChipComponent,
  subcomponents: { UiChipGroupComponent },
  // Compodoc cannot read the shared union aliases, so the selects are declared here.
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'accent', 'feature', 'warning', 'danger', 'success'] },
    variant: { control: 'select', options: ['subtle', 'outline'] },
    size: { control: 'select', options: ['sm', 'md'] },
  },
  decorators: [moduleMetadata({ imports: [UiChipComponent, UiChipGroupComponent] })],
  args: { label: 'Project: CNCF', tone: 'accent', variant: 'subtle', size: 'md', dismissible: true },
  render: (args) => ({ props: args, template: `<lfx-ui-chip ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiChipComponent>;

/** The filter-chip default: accent subtle, 24px, with a × that names itself "Remove Project: CNCF". The chip only emits `dismissed`; the parent removes it. */
export const Default: Story = {};
export const Small: Story = { args: { size: 'sm' } };
/** A read-only chip with the same look and no ×. A chip that is never removable is a plain `lfx-ui-badge`. */
export const NotDismissible: Story = { args: { dismissible: false } };
export const Outline: Story = { args: { variant: 'outline', label: 'v2.4.0' } };
export const Tones: Story = {
  render: () => ({
    template: `
      <lfx-ui-chip-group ariaLabel="Chip tones">
        <lfx-ui-chip label="Neutral" tone="neutral" />
        <lfx-ui-chip label="Accent" tone="accent" />
        <lfx-ui-chip label="Feature" tone="feature" />
        <lfx-ui-chip label="Warning" tone="warning" />
        <lfx-ui-chip label="Danger" tone="danger" />
        <lfx-ui-chip label="Success" tone="success" />
        <lfx-ui-chip label="Outline" variant="outline" />
      </lfx-ui-chip-group>`,
  }),
};
/** A leading icon goes in the `icon` slot. */
export const WithIcon: Story = {
  render: () => ({ template: `<lfx-ui-chip label="Organized by me"><i slot="icon" class="fa-light fa-user" aria-hidden="true"></i></lfx-ui-chip>` }),
};

/**
 * The applied-filters row of the meetings list. Remove a chip with its × or Enter on it: focus moves to the next chip, then the previous one, and
 * with none left to the button that opens the filters, which is passed as `fallbackFocus` because the row disappears when it is empty.
 */
export const AppliedFilters: Story = {
  render: () => ({
    props: {
      filters: signal(['Project: CNCF', 'Meeting type: Committee', 'RSVP: Going', 'Organized by me']),
      remove(this: { filters: ReturnType<typeof signal<string[]>> }, filter: string) {
        this.filters.update((list) => list.filter((item) => item !== filter));
      },
      reset(this: { filters: ReturnType<typeof signal<string[]>> }) {
        this.filters.set(['Project: CNCF', 'Meeting type: Committee', 'RSVP: Going', 'Organized by me']);
      },
    },
    template: `
      <div class="flex flex-col gap-[16px]">
        <button #filtersButton type="button" class="edge inline-flex h-ui-small w-fit items-center rounded-[10px] bg-ui-background-100 px-[10px] button-14 text-ui-neutral-900 focus-visible:shadow-focus focus-visible:outline-none" (click)="reset()">
          Filters (click to reset)
        </button>
        @if (filters().length) {
          <lfx-ui-chip-group ariaLabel="Applied filters" [fallbackFocus]="filtersButton">
            @for (filter of filters(); track filter) {
              <lfx-ui-chip [label]="filter" (dismissed)="remove(filter)" />
            }
          </lfx-ui-chip-group>
        }
      </div>`,
  }),
};
