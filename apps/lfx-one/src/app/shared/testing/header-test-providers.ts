// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Provider, signal } from '@angular/core';
import { AppService } from '@services/app.service';
import { LensService } from '@services/lens.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { vi } from 'vitest';

/**
 * jsdom doesn't implement matchMedia; PrimeNG's Menubar (rendered inside <lfx-header/>) calls it
 * on init to bind a responsive listener. Call once, e.g. in a `beforeAll`, before rendering any
 * component tree that includes <lfx-header/>.
 */
export function installMatchMediaShim(): void {
  window.matchMedia ??= ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

/**
 * Minimal mocks for <lfx-header/>'s direct service dependencies (Router is satisfied separately
 * via `provideRouter([])`) — enough to render it unauthenticated without resolving the real
 * LensService -> PersonaService -> AccountContextService chain.
 */
export function headerTestProviders(): Provider[] {
  return [
    { provide: UserService, useValue: { authenticated: signal(false), getCurrentUserProfile: vi.fn(() => of(null)) } },
    { provide: LensService, useValue: { setLens: vi.fn() } },
    { provide: ProjectService, useValue: { searchProjects: vi.fn(() => of([])) } },
    { provide: AppService, useValue: { toggleMobileSidebar: vi.fn() } },
  ];
}
