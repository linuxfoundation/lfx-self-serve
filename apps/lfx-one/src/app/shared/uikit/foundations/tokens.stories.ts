// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Meta, StoryObj } from '@storybook/angular';

/**
 * Visual reference for the LFX UI Library tokens (`src/styles/ui-tokens.css`) and the Tailwind
 * utilities mapped onto them (`tailwind.config.js`). The dark values are shown by `DarkTheme`;
 * the app has no theme switch yet.
 */
const meta: Meta = {
  title: 'Foundations/Tokens',
  tags: ['!autodocs'],
};
export default meta;
type Story = StoryObj;

export const Colors: Story = {
  render: () => ({
    props: {
      steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900],
      scales: ['neutral', 'neutral-alpha', 'accent', 'success', 'warning', 'danger', 'feature'],
      singles: ['background-100', 'background-200', 'focus', 'overlay'],
    },
    template: `
      <div class="flex flex-col gap-6 p-6 bg-ui-background-100 text-ui-neutral-900">
        <div>
          <p class="heading-14 mb-2">Single roles</p>
          <div class="flex gap-4">
            @for (name of singles; track name) {
              <div class="flex flex-col gap-1 label-12 text-ui-neutral-600">
                <div class="h-ui-large w-24 rounded-ui-sm edge" [style.background]="'var(--ui-' + name + ')'"></div>
                ui-{{ name }}
              </div>
            }
          </div>
        </div>
        @for (scale of scales; track scale) {
          <div>
            <p class="heading-14 mb-2">ui-{{ scale }}-*</p>
            <div class="flex gap-2">
              @for (step of steps; track step) {
                <div class="flex flex-col gap-1 label-12 text-ui-neutral-600">
                  <div class="h-ui-large w-14 rounded-ui-xs edge" [style.background]="'var(--ui-' + scale + '-' + step + ')'"></div>
                  {{ step }}
                </div>
              }
            </div>
          </div>
        }
      </div>
    `,
  }),
};

export const Shadows: Story = {
  render: () => ({
    template: `
      <div class="flex flex-wrap gap-8 p-8 bg-ui-background-200 text-ui-neutral-900">
        <div class="h-24 w-40 rounded-ui-md bg-ui-background-100 shadow-border p-3 label-14">shadow-border</div>
        <div class="h-24 w-40 rounded-ui-md bg-ui-background-100 shadow-small p-3 label-14">shadow-small</div>
        <div class="h-24 w-40 rounded-ui-md bg-ui-background-100 shadow-medium p-3 label-14">shadow-medium</div>
        <div class="h-24 w-40 rounded-ui-md bg-ui-background-100 shadow-large p-3 label-14">shadow-large</div>
        <div class="h-24 w-40 rounded-ui-md bg-ui-background-100 shadow-tooltip p-3 label-14">shadow-tooltip</div>
        <div class="h-24 w-40 rounded-ui-md bg-ui-background-100 shadow-menu p-3 label-14">shadow-menu</div>
        <div class="h-24 w-40 rounded-ui-lg bg-ui-background-100 shadow-modal p-3 label-14">shadow-modal</div>
        <div class="h-24 w-40 rounded-ui-lg bg-ui-background-100 shadow-fullscreen p-3 label-14">shadow-fullscreen</div>
        <div class="h-24 w-40 rounded-ui-sm bg-ui-background-100 shadow-focus p-3 label-14">shadow-focus</div>
        <div class="h-24 w-40 rounded-ui-md bg-ui-background-100 edge hover:edge-hover p-3 label-14">edge (hover: edge-hover)</div>
      </div>
    `,
  }),
};

export const RadiiAndHeights: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col gap-8 p-6 bg-ui-background-100 text-ui-neutral-900">
        <div class="flex items-end gap-4">
          <div class="h-16 w-24 rounded-ui-xs bg-ui-accent-100 p-2 label-12">rounded-ui-xs 6px</div>
          <div class="h-16 w-24 rounded-ui-sm bg-ui-accent-100 p-2 label-12">rounded-ui-sm 12px</div>
          <div class="h-16 w-24 rounded-ui-md bg-ui-accent-100 p-2 label-12">rounded-ui-md 16px</div>
          <div class="h-16 w-24 rounded-ui-lg bg-ui-accent-100 p-2 label-12">rounded-ui-lg 20px</div>
          <div class="h-16 w-24 rounded-ui-full bg-ui-accent-100 p-2 label-12">rounded-ui-full</div>
        </div>
        <div class="flex items-end gap-4">
          <div class="h-ui-tiny w-32 rounded-ui-sm bg-ui-accent-500 px-2 button-12 text-ui-white flex items-center">h-ui-tiny 24px</div>
          <div class="h-ui-small w-32 rounded-ui-sm bg-ui-accent-500 px-2 button-12 text-ui-white flex items-center">h-ui-small 32px</div>
          <div class="h-ui-medium w-32 rounded-ui-sm bg-ui-accent-500 px-2 button-14 text-ui-white flex items-center">h-ui-medium 40px</div>
          <div class="h-ui-large w-32 rounded-ui-md bg-ui-accent-500 px-2 button-16 text-ui-white flex items-center">h-ui-large 48px</div>
        </div>
      </div>
    `,
  }),
};

export const Motion: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col gap-6 p-6 bg-ui-background-100 text-ui-neutral-900">
        <p class="copy-14">Hover a bar to run it. Durations use <code>ease-ui-standard</code>; easing rows use <code>duration-ui-slow</code>. Honours reduced motion.</p>
        <div class="flex flex-col gap-3">
          <div class="group flex items-center gap-4">
            <span class="label-14-mono w-48">duration-ui-fast</span>
            <div class="h-ui-tiny w-80 rounded-ui-xs bg-ui-neutral-100 overflow-hidden">
              <div class="h-full w-4 bg-ui-accent-500 motion-safe:transition-[width] motion-safe:duration-ui-fast motion-safe:ease-ui-standard group-hover:w-full"></div>
            </div>
          </div>
          <div class="group flex items-center gap-4">
            <span class="label-14-mono w-48">duration-ui-base</span>
            <div class="h-ui-tiny w-80 rounded-ui-xs bg-ui-neutral-100 overflow-hidden">
              <div class="h-full w-4 bg-ui-accent-500 motion-safe:transition-[width] motion-safe:duration-ui-base motion-safe:ease-ui-standard group-hover:w-full"></div>
            </div>
          </div>
          <div class="group flex items-center gap-4">
            <span class="label-14-mono w-48">duration-ui-slow</span>
            <div class="h-ui-tiny w-80 rounded-ui-xs bg-ui-neutral-100 overflow-hidden">
              <div class="h-full w-4 bg-ui-accent-500 motion-safe:transition-[width] motion-safe:duration-ui-slow motion-safe:ease-ui-standard group-hover:w-full"></div>
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-3">
          <div class="group flex items-center gap-4">
            <span class="label-14-mono w-48">ease-ui (spring)</span>
            <div class="h-ui-tiny w-80 rounded-ui-xs bg-ui-neutral-100 overflow-hidden">
              <div class="h-full w-4 bg-ui-accent-500 motion-safe:transition-[width] motion-safe:duration-ui-slow motion-safe:ease-ui group-hover:w-full"></div>
            </div>
          </div>
          <div class="group flex items-center gap-4">
            <span class="label-14-mono w-48">ease-ui-standard</span>
            <div class="h-ui-tiny w-80 rounded-ui-xs bg-ui-neutral-100 overflow-hidden">
              <div class="h-full w-4 bg-ui-accent-500 motion-safe:transition-[width] motion-safe:duration-ui-slow motion-safe:ease-ui-standard group-hover:w-full"></div>
            </div>
          </div>
        </div>
      </div>
    `,
  }),
};

export const Typography: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col gap-2 p-6 bg-ui-background-100 text-ui-neutral-900">
        <p class="heading-72">heading-72</p>
        <p class="heading-48">heading-48</p>
        <p class="heading-32">heading-32</p>
        <p class="heading-24">heading-24</p>
        <p class="heading-20">heading-20</p>
        <p class="heading-16">heading-16</p>
        <p class="heading-14">heading-14</p>
        <p class="label-20">label-20</p>
        <p class="label-16">label-16</p>
        <p class="label-14">label-14</p>
        <p class="label-13">label-13</p>
        <p class="label-12">label-12</p>
        <p class="label-14-mono">label-14-mono</p>
        <p class="copy-24">copy-24</p>
        <p class="copy-18">copy-18</p>
        <p class="copy-16">copy-16</p>
        <p class="copy-14">copy-14</p>
        <p class="copy-13">copy-13</p>
        <p class="copy-13-mono">copy-13-mono</p>
        <p class="button-16">button-16</p>
        <p class="button-14">button-14</p>
        <p class="button-12">button-12</p>
        <p class="text-label-14 text-ui-neutral-600">text-label-14 (size and line height only)</p>
      </div>
    `,
  }),
};

export const DarkTheme: Story = {
  render: () => ({
    template: `
      <div data-theme="dark" class="flex flex-wrap gap-6 p-6 bg-ui-background-100 text-ui-neutral-900">
        <div class="h-24 w-48 rounded-ui-md bg-ui-background-200 shadow-small p-3 label-14">Dark surface, shadow-small</div>
        <div class="h-ui-medium rounded-ui-sm bg-ui-accent-500 px-4 button-14 text-ui-white flex items-center">Accent button</div>
        <div class="h-ui-medium rounded-ui-sm bg-ui-danger-50 text-ui-danger-700 px-4 label-14 flex items-center">Danger subtle</div>
      </div>
    `,
  }),
};
