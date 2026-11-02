// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiScrollerComponent } from './scroller.component';

const meta: Meta<UiScrollerComponent> = {
  title: 'Uikit/Scroller',
  component: UiScrollerComponent,
  decorators: [moduleMetadata({ imports: [UiScrollerComponent] })],
  args: { label: 'Projects', direction: 'horizontal', buttons: false, maxHeight: 220 },
  render: (args) => ({
    props: args,
    template: `
      <div class="max-w-[640px] px-4">
        <lfx-ui-scroller [label]="label" [direction]="direction" [buttons]="buttons" [maxHeight]="maxHeight">
          @for (project of ['Kubernetes', 'Envoy', 'Prometheus', 'OpenTelemetry', 'Argo']; track project) {
            <div class="flex w-[200px] flex-col gap-2 rounded-ui-sm bg-ui-background-100 p-4 edge">
              <strong class="label-14">{{ project }}</strong>
              <span class="copy-13 text-ui-neutral-600">1,284 contributors</span>
            </div>
          }
        </lfx-ui-scroller>
      </div>
    `,
  }),
};
export default meta;
type Story = StoryObj<UiScrollerComponent>;

export const Horizontal: Story = {};
export const WithButtons: Story = { args: { buttons: true } };
export const Vertical: Story = {
  args: { label: 'Recent runs', direction: 'vertical' },
  render: (args) => ({
    props: args,
    template: `
      <div class="max-w-[320px]">
        <lfx-ui-scroller [label]="label" [direction]="direction" [maxHeight]="maxHeight">
          @for (run of [1, 2, 3, 4, 5, 6, 7, 8]; track run) {
            <div class="rounded-ui-xs bg-ui-background-100 p-3 text-copy-14 edge">Deployment {{ run }}</div>
          }
        </lfx-ui-scroller>
      </div>
    `,
  }),
};
export const Both: Story = {
  args: { label: 'Build log', direction: 'both' },
  render: (args) => ({
    props: { ...args, lines: Array.from({ length: 12 }, (_, index) => `${String(index + 1).padStart(2, '0')} ` + 'build step output '.repeat(14)) },
    template: `
      <div class="max-w-[420px]">
        <lfx-ui-scroller [label]="label" [direction]="direction" [maxHeight]="maxHeight">
          <pre class="p-3 font-mono text-[12px] leading-[16px]">{{ lines.join('\n') }}</pre>
        </lfx-ui-scroller>
      </div>
    `,
  }),
};
