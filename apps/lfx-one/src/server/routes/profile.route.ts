// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ProfileController } from '../controllers/profile.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();

const profileController = new ProfileController();

/**
 * Profile routes for authenticated users
 * All routes require authentication via auth middleware
 *
 * Write and Flow C (Auth0 Management API) routes are guarded by `blockDuringImpersonation`:
 * profile mutations act on the real user's account (via the impersonator's management token), so
 * they must be rejected while impersonating. Profile viewing during impersonation is read-only.
 */

// Flow C: Profile auth routes for Auth0 Management API token
// GET /api/profile/auth/start - Initiate Flow C authorization
router.get('/auth/start', blockDuringImpersonation, (req, res) => profileController.startProfileAuth(req, res));

// GET /api/profile/auth/callback - Handle Auth0 callback
router.get('/auth/callback', blockDuringImpersonation, (req, res) => profileController.handleProfileAuthCallback(req, res));

// GET /api/profile/auth/status - Check if management token is available (blocked while impersonating:
// it would report the impersonator's Flow C token state, which is irrelevant to the read-only target view)
router.get('/auth/status', blockDuringImpersonation, (req, res) => profileController.getProfileAuthStatus(req, res));

// GET /api/profile - Get current user's combined profile data
router.get('/', (req, res, next) => profileController.getCurrentUserProfile(req, res, next));

// PATCH /api/profile - Update user metadata via NATS (replaces separate user and details endpoints)
router.patch('/', blockDuringImpersonation, (req, res, next) => profileController.updateUserMetadata(req, res, next));

// Email management routes (backed by auth-service via NATS)

// GET /api/profile/emails - Get current user's email management data
router.get('/emails', (req, res, next) => profileController.getUserEmails(req, res, next));

// PUT /api/profile/emails/:emailId/primary - Set email as primary; :emailId is the email address
router.put('/emails/:emailId/primary', blockDuringImpersonation, (req, res, next) => profileController.setPrimaryEmail(req, res, next));

// Meeting-invitation email preference routes (backed by meeting-service via NATS)

// GET /api/profile/emails/meeting-invite - Resolve the user's preferred meeting-invitation email
router.get('/emails/meeting-invite', (req, res, next) => profileController.getMeetingInviteEmail(req, res, next));

// PUT /api/profile/emails/meeting-invite - Set the user's preferred meeting-invitation email
router.put('/emails/meeting-invite', blockDuringImpersonation, (req, res, next) => profileController.setMeetingInviteEmail(req, res, next));

// GET /api/profile/developer - Get current user's developer token information
router.get('/developer', (req, res, next) => profileController.getDeveloperTokenInfo(req, res, next));

// Linux.com email alias routes (backed by auth-service + forwards-service via NATS)

// GET /api/profile/linux-email - Resolve the user's Linux.com alias state
router.get('/linux-email', (req, res, next) => profileController.getLinuxAlias(req, res, next));

// POST /api/profile/linux-email/claim - Claim an alias and set its forwarding target
router.post('/linux-email/claim', blockDuringImpersonation, (req, res, next) => profileController.claimLinuxAlias(req, res, next));

// PUT /api/profile/linux-email/forward - Update the forwarding target for a claimed alias
router.put('/linux-email/forward', blockDuringImpersonation, (req, res, next) => profileController.updateLinuxForward(req, res, next));

// POST /api/profile/reset-password - Send password reset email via LF Login service
router.post('/reset-password', blockDuringImpersonation, (req, res, next) => profileController.sendPasswordResetEmail(req, res, next));

// POST /api/profile/change-password - Change user's password
router.post('/change-password', blockDuringImpersonation, (req, res, next) => profileController.changePassword(req, res, next));

// POST /api/profile/identities/email/send-code - Send email verification code
router.post('/identities/email/send-code', blockDuringImpersonation, (req, res, next) => profileController.sendEmailVerification(req, res, next));

// POST /api/profile/identities/email/verify - Verify OTP and link email identity
router.post('/identities/email/verify', blockDuringImpersonation, (req, res, next) => profileController.verifyAndLinkEmail(req, res, next));

// GET /api/profile/project-affiliations - Get user's project affiliations from CDP
router.get('/project-affiliations', (req, res, next) => profileController.getProjectAffiliations(req, res, next));

// PATCH /api/profile/project-affiliations/:projectId - Update project affiliations
router.patch('/project-affiliations/:projectId', blockDuringImpersonation, (req, res, next) => profileController.patchProjectAffiliation(req, res, next));

// GET /api/profile/work-experiences - Get user's work experiences from CDP
router.get('/work-experiences', (req, res, next) => profileController.getWorkExperiences(req, res, next));

// PATCH /api/profile/work-experiences/:workExperienceId - Confirm a work experience
router.patch('/work-experiences/:workExperienceId', blockDuringImpersonation, (req, res, next) => profileController.confirmWorkExperience(req, res, next));

// DELETE /api/profile/work-experiences/:workExperienceId - Delete a work experience
router.delete('/work-experiences/:workExperienceId', blockDuringImpersonation, (req, res, next) => profileController.deleteWorkExperience(req, res, next));

// PUT /api/profile/work-experiences/:workExperienceId - Update a work experience
router.put('/work-experiences/:workExperienceId', blockDuringImpersonation, (req, res, next) => profileController.updateWorkExperience(req, res, next));

// POST /api/profile/work-experiences - Create a new work experience
router.post('/work-experiences', blockDuringImpersonation, (req, res, next) => profileController.createWorkExperience(req, res, next));

// GET /api/profile/identities/social/connect - Initiate social identity OAuth flow
router.get('/identities/social/connect', blockDuringImpersonation, (req, res) => profileController.startSocialConnect(req, res));

// GET /api/profile/identities - Get user's CDP identities
router.get('/identities', (req, res, next) => profileController.getIdentities(req, res, next));

// PATCH /api/profile/identities/:identityId - Reject an identity (mark as not me)
router.patch('/identities/:identityId', blockDuringImpersonation, (req, res, next) => profileController.rejectIdentity(req, res, next));

export default router;
