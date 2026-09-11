// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, TitleStrategy } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { LfxTitleStrategy } from './lfx-title.strategy';

@Component({ selector: 'lfx-title-host', standalone: true, template: '' })
class TitleHostComponent {}

describe('LfxTitleStrategy', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  async function navigate(routes: Parameters<typeof provideRouter>[0], url: string): Promise<string> {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideLocationMocks(), { provide: TitleStrategy, useClass: LfxTitleStrategy }],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    return TestBed.inject(Title).getTitle();
  }

  it('applies a route title with the LFX suffix', async () => {
    const title = await navigate([{ path: 'meetings', title: 'My Meetings', component: TitleHostComponent }], '/meetings');
    expect(title).toBe('My Meetings · LFX');
  });

  it('falls back to data.title when the Angular title key is absent', async () => {
    const title = await navigate([{ path: 'overview', data: { title: 'Org Overview' }, component: TitleHostComponent }], '/overview');
    expect(title).toBe('Org Overview · LFX');
  });

  it('prefers the leaf route title over a parent title', async () => {
    const title = await navigate(
      [
        {
          path: 'meetings',
          title: 'Project Meetings',
          children: [{ path: 'create', title: 'Create Meeting', component: TitleHostComponent }],
        },
      ],
      '/meetings/create'
    );
    expect(title).toBe('Create Meeting · LFX');
  });

  it('inherits the parent title when the leaf has none', async () => {
    const title = await navigate(
      [
        {
          path: 'meetings',
          title: 'Project Meetings',
          children: [{ path: '', component: TitleHostComponent }],
        },
      ],
      '/meetings'
    );
    expect(title).toBe('Project Meetings · LFX');
  });

  it('does not double-suffix an already branded docs title', async () => {
    const title = await navigate([{ path: 'docs', title: 'LFX Documentation', component: TitleHostComponent }], '/docs');
    expect(title).toBe('LFX Documentation');
  });
});
