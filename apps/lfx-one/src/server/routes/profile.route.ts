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

// Flow C: Profile auth routes for Auth0 Management API token
// GET /api/profile/auth/start - Initiate Flow C authorization
router.get('/auth/start', (req, res) => profileController.startProfileAuth(req, res));

// GET /api/profile/auth/callback - Handle Auth0 callback
router.get('/auth/callback', (req, res) => profileController.handleProfileAuthCallback(req, res));

// GET /api/profile/auth/status - Check if management token is available
router.get('/auth/status', (req, res) => profileController.getProfileAuthStatus(req, res));

// GET /api/profile - Get current user's combined profile data
router.get('/', (req, res, next) => profileController.getCurrentUserProfile(req, res, next));

// PATCH /api/profile - Update user metadata via NATS (replaces separate user and details endpoints)
router.patch('/', (req, res, next) => profileController.updateUserMetadata(req, res, next));

// Email management routes

// GET /api/profile/emails - Get current user's email management data
router.get('/emails', (req, res, next) => profileController.getUserEmails(req, res, next));

// POST /api/profile/emails - Add new email for current user
router.post('/emails', (req, res, next) => profileController.addUserEmail(req, res, next));

// DELETE /api/profile/emails/:emailId - Delete user email
router.delete('/emails/:emailId', (req, res, next) => profileController.deleteUserEmail(req, res, next));

// PUT /api/profile/emails/:emailId/primary - Set email as primary
router.put('/emails/:emailId/primary', (req, res, next) => profileController.setPrimaryEmail(req, res, next));

// GET /api/profile/email-preferences - Get user email preferences
router.get('/email-preferences', (req, res, next) => profileController.getEmailPreferences(req, res, next));

// PUT /api/profile/email-preferences - Update user email preferences
router.put('/email-preferences', (req, res, next) => profileController.updateEmailPreferences(req, res, next));

// GET /api/profile/developer - Get current user's developer token information
router.get('/developer', (req, res, next) => profileController.getDeveloperTokenInfo(req, res, next));

// POST /api/profile/identities/email/send-code - Send email verification code
router.post('/identities/email/send-code', (req, res, next) => profileController.sendEmailVerification(req, res, next));

// POST /api/profile/identities/email/verify - Verify OTP and link email identity
router.post('/identities/email/verify', (req, res, next) => profileController.verifyAndLinkEmail(req, res, next));

// GET /api/profile/project-affiliations - Get user's project affiliations from CDP
router.get('/project-affiliations', (req, res, next) => profileController.getProjectAffiliations(req, res, next));

// PATCH /api/profile/project-affiliations/:projectId - Update project affiliations
router.patch('/project-affiliations/:projectId', (req, res, next) => profileController.patchProjectAffiliation(req, res, next));

// GET /api/profile/work-experiences - Get user's work experiences from CDP
router.get('/work-experiences', (req, res, next) => profileController.getWorkExperiences(req, res, next));

// PATCH /api/profile/work-experiences/:workExperienceId - Confirm a work experience
router.patch('/work-experiences/:workExperienceId', (req, res, next) => profileController.confirmWorkExperience(req, res, next));

// DELETE /api/profile/work-experiences/:workExperienceId - Delete a work experience
router.delete('/work-experiences/:workExperienceId', (req, res, next) => profileController.deleteWorkExperience(req, res, next));

// PUT /api/profile/work-experiences/:workExperienceId - Update a work experience
router.put('/work-experiences/:workExperienceId', (req, res, next) => profileController.updateWorkExperience(req, res, next));

// POST /api/profile/work-experiences - Create a new work experience
router.post('/work-experiences', (req, res, next) => profileController.createWorkExperience(req, res, next));

// GET /api/profile/identities/social/connect - Initiate social identity OAuth flow
router.get('/identities/social/connect', (req, res) => profileController.startSocialConnect(req, res));

// GET /api/profile/identities - Get user's CDP identities
router.get('/identities', (req, res, next) => profileController.getIdentities(req, res, next));

// PATCH /api/profile/identities/:identityId - Reject an identity (mark as not me)
router.patch('/identities/:identityId', (req, res, next) => profileController.rejectIdentity(req, res, next));

export default router;
