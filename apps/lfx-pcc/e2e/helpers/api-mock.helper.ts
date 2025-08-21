// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Page } from '@playwright/test';

import { getMockProject } from '../fixtures/mock-data';

/**
 * Helper class for mocking the project slug endpoint in Playwright tests
 * Only handles /api/projects/:slug endpoint that depends on NATS
 */
export class ApiMockHelper {
  /**
   * Setup mock for the project slug endpoint only
   * @param page - Playwright page instance
   */
  static async setupProjectSlugMock(page: Page): Promise<void> {
    // Mock individual project by slug endpoint (/api/projects/:slug)
    await page.route('**/api/projects/*', async (route) => {
      const url = route.request().url();

      // Skip other endpoints - only handle direct slug requests
      if (url.includes('/search') || url.includes('/recent-activity')) {
        await route.continue();
        return;
      }

      const pathSegments = url.split('/');
      const slug = pathSegments[pathSegments.length - 1].split('?')[0]; // Remove query params

      console.log(`[Mock] Intercepting project request for slug: "${slug}"`);

      const project = getMockProject(slug);

      if (!project) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Project not found',
            code: 'PROJECT_NOT_FOUND',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(project),
      });
    });
  }
}
