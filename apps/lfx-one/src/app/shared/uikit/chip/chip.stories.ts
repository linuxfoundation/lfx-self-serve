// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { argsToTemplate, type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
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
  decorators: [moduleMetadata({ imports: [UiChipComponent, UiChipGroupComponent, UiButtonComponent] })],
  args: { label: 'Project: CNCF', tone: 'accent', variant: 'subtle', size: 'sm', dismissible: true },
  render: (args) => ({ props: args, template: `<lfx-ui-chip ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiChipComponent>;

/** The filter-chip default: accent subtle, 20px, with a × that names itself "Remove Project: CNCF". The chip only emits `dismissed`; the parent removes it. */
export const Default: Story = {};
/** The 24px size, the badge's default. */
export const Medium: Story = { args: { size: 'md' } };
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

/** A label longer than its container is cut off with an ellipsis and shows in full in a tooltip. The × stays visible, and its name carries the full text. */
export const LongValue: Story = {
  render: () => ({
    template: `
      <div class="w-[240px]">
        <lfx-ui-chip-group ariaLabel="Applied filters">
          <lfx-ui-chip label="Project: The Linux Foundation Core Infrastructure Initiative Best Practices Badge" />
          <lfx-ui-chip label="RSVP: Going" />
        </lfx-ui-chip-group>
      </div>`,
  }),
};

/**
 * The applied-filters row of the meetings list. Remove a chip with its × or Enter on it: focus moves to the next chip, then the previous one, and
 * with none left to the `lfx-ui-button` that opens the filters, which is passed as `fallbackFocus` because the row disappears when it is empty.
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
        <lfx-ui-button #filtersButton variant="secondary" size="small" (click)="reset()">Filters (click to reset)</lfx-ui-button>
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

/** A removal that waits for a request, here 800ms. Focus stays on the × until the chip is gone, then moves to the next chip; a second activation meanwhile does nothing. */
export const SlowRemoval: Story = {
  render: () => ({
    props: {
      filters: signal(['Project: CNCF', 'Meeting type: Committee', 'RSVP: Going']),
      remove(this: { filters: ReturnType<typeof signal<string[]>> }, filter: string) {
        setTimeout(() => this.filters.update((list) => list.filter((item) => item !== filter)), 800);
      },
    },
    template: `
      <lfx-ui-chip-group ariaLabel="Applied filters">
        @for (filter of filters(); track filter) {
          <lfx-ui-chip [label]="filter" (dismissed)="remove(filter)" />
        }
      </lfx-ui-chip-group>`,
  }),
};
