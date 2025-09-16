// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ProfileController } from '../controllers/profile.controller';

const router = Router();

const profileController = new ProfileController();

/**
 * Profile routes for authenticated users
 * All routes require authentication via auth middleware
 */

// GET /api/profile - Get current user's combined profile data
router.get('/', (req, res, next) => profileController.getCurrentUserProfile(req, res, next));

// PATCH /api/profile/user - Update user table fields (first_name, last_name, username)
router.patch('/user', (req, res, next) => profileController.updateCurrentUser(req, res, next));

// PATCH /api/profile/details - Update profile table fields (title, organization, etc.)
router.patch('/details', (req, res, next) => profileController.updateCurrentProfile(req, res, next));

export default router;
