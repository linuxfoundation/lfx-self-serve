// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { SocialListeningController } from '../controllers/social-listening.controller';
import { requireExecutiveDirector } from '../middleware/require-executive-director.middleware';

const router = Router();

const socialListeningController = new SocialListeningController();

/**
 * Social Listening is an ED-only surface (LFXV2-3002). The gate is applied to the whole router so
 * every current and future endpoint is covered — the client-side `executiveDirectorGuard` is a
 * routing concern, not an authorization boundary. Rate limiting comes from the app-wide
 * `apiRateLimiter` mounted on `/api/` in `server.ts`; these are read-only Snowflake queries behind a
 * 30-minute cache, so they don't warrant a tighter bucket than the shared 500/minute.
 */
router.use(requireExecutiveDirector);

// Mentions feed + total
router.get('/mentions-feed', (req, res, next) => socialListeningController.getMentionsFeed(req, res, next));
router.get('/mentions-count', (req, res, next) => socialListeningController.getMentionsCount(req, res, next));

// Filter + scope options
router.get('/mentions-projects', (req, res, next) => socialListeningController.getMentionsProjects(req, res, next));
router.get('/mentions-platforms', (req, res, next) => socialListeningController.getMentionsPlatforms(req, res, next));
router.get('/mentions-languages', (req, res, next) => socialListeningController.getMentionsLanguages(req, res, next));
router.get('/mentions-keywords', (req, res, next) => socialListeningController.getMentionsKeywords(req, res, next));
router.get('/mentions-tags', (req, res, next) => socialListeningController.getMentionsTags(req, res, next));
router.get('/mentions-authors', (req, res, next) => socialListeningController.getMentionsAuthors(req, res, next));

// Analytics tab (feed-derived — see social-listening.service.ts)
router.get('/analytics-overview', (req, res, next) => socialListeningController.getAnalyticsOverview(req, res, next));
router.get('/analytics-over-time', (req, res, next) => socialListeningController.getAnalyticsOverTime(req, res, next));
router.get('/analytics-platform-distribution', (req, res, next) => socialListeningController.getAnalyticsPlatformDistribution(req, res, next));
router.get('/analytics-sentiment-distribution', (req, res, next) => socialListeningController.getAnalyticsSentimentDistribution(req, res, next));
router.get('/analytics-top-projects', (req, res, next) => socialListeningController.getAnalyticsTopProjects(req, res, next));

export default router;
