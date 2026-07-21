// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Router } from 'express';

import { CrowdfundingController } from '../controllers/crowdfunding.controller';

const router = Router();
const crowdfundingController = new CrowdfundingController();

router.get('/auth/start', (req, res) => crowdfundingController.startCrowdfundingAuth(req, res));

router.post('/payment-method', (req, res, next) => crowdfundingController.saveMyPaymentMethod(req, res, next));
router.get('/payment-method', (req, res, next) => crowdfundingController.getMyPaymentMethod(req, res, next));
router.delete('/payment-method', (req, res, next) => crowdfundingController.deleteMyPaymentMethod(req, res, next));
router.get('/donation-stats', (req, res, next) => crowdfundingController.getMyDonationStats(req, res, next));
router.get('/recurring-donations/:id', (req, res, next) => crowdfundingController.getRecurringDonationById(req, res, next));
router.get('/recurring-donations', (req, res, next) => crowdfundingController.getMyRecurringDonations(req, res, next));
router.get('/my-donations', (req, res, next) => crowdfundingController.getMyDonations(req, res, next));
router.post('/presigned-url', (req, res, next) => crowdfundingController.getPresignedUrl(req, res, next));
router.delete('/subscriptions/:id', (req, res, next) => crowdfundingController.cancelSubscription(req, res, next));
router.get('/initiatives-stats', (req, res, next) => crowdfundingController.getInitiativesStats(req, res, next));
router.get('/initiatives', (req, res, next) => crowdfundingController.getMyInitiatives(req, res, next));
router.get('/initiatives/:id/announcements', (req, res, next) => crowdfundingController.getAnnouncements(req, res, next));
router.post('/initiatives/:id/announcements', (req, res, next) => crowdfundingController.createAnnouncement(req, res, next));
router.put('/initiatives/:id/announcements/:announcementId', (req, res, next) => crowdfundingController.updateAnnouncement(req, res, next));
router.delete('/initiatives/:id/announcements/:announcementId', (req, res, next) => crowdfundingController.deleteAnnouncement(req, res, next));
router.get('/initiatives/:slug/transactions', (req, res, next) => crowdfundingController.getInitiativeTransactions(req, res, next));
router.get('/initiatives/:slug/my-transactions', (req, res, next) => crowdfundingController.getMyInitiativeTransactions(req, res, next));
router.patch('/initiatives/:id', (req, res, next) => crowdfundingController.updateInitiative(req, res, next));
router.get('/initiatives/:slug', (req, res, next) => crowdfundingController.getInitiativeBySlug(req, res, next));

export default router;
