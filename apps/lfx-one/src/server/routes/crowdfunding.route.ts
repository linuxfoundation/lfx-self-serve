// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Router } from 'express';

import { CrowdfundingController } from '../controllers/crowdfunding.controller';

const router = Router();
const crowdfundingController = new CrowdfundingController();

router.post('/payment-method', (req, res, next) => crowdfundingController.saveMyPaymentMethod(req, res, next));
router.get('/payment-method', (req, res, next) => crowdfundingController.getMyPaymentMethod(req, res, next));
router.get('/donation-stats', (req, res, next) => crowdfundingController.getMyDonationStats(req, res, next));
router.get('/recurring-donations', (req, res, next) => crowdfundingController.getMyRecurringDonations(req, res, next));
router.get('/my-donations', (req, res, next) => crowdfundingController.getMyDonations(req, res, next));
router.get('/initiatives-stats', (req, res, next) => crowdfundingController.getInitiativesStats(req, res, next));
router.get('/initiatives', (req, res, next) => crowdfundingController.getMyInitiatives(req, res, next));
router.get('/initiatives/:slug/transactions', (req, res, next) => crowdfundingController.getInitiativeTransactions(req, res, next));
router.get('/initiatives/:slug', (req, res, next) => crowdfundingController.getInitiativeBySlug(req, res, next));

export default router;
