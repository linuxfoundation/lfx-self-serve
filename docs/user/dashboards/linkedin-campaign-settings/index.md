---
title: LinkedIn ad variants
description: Edit each LinkedIn ad variant's intro text and headline, add or remove variants, and give each variant its own image on the Campaigns page's Implement tab.
audience: [executive-director]
product_area: Dashboards
tags: [campaigns, paid marketing, linkedin ads, sponsored content, ad variants, intro text, headline, images, implement]
last_updated: 2026-11-11
intercom_collection: Dashboards
---

When you create a LinkedIn campaign from the **Campaigns** page in the Foundation lens, each ad variant in the LinkedIn section becomes its own ad in the campaign. The **Implement** tab fills the variants in from the brief, and you can edit each one's intro text and headline, add or remove variants, and give each variant its own image.

## Where to find them

1. Open **Campaigns** in the Foundation lens and choose **Paid Marketing**.
2. Open the **Implement** tab for a brief that includes LinkedIn Ads.
3. In the **LinkedIn Sponsored Content** section, scroll to **Ad variants**. The heading shows how many variants there are, out of the most you can have.

## Edit a variant

Each variant has an **Intro text** box (the body of the post) and a **Headline** box (shown below the link card). They start with the brief's copy. A count under each box shows how many characters the text uses:

| Field      | Most characters |
| ---------- | --------------- |
| Intro text | 600             |
| Headline   | 200             |

Spaces at the start and end are not counted. An em dash (—) or en dash (–) counts as two characters, because it is sent as a comma and a space.

Both fields are required. If a field is empty, holds only spaces or dashes, or is over its limit, a message appears under it and **Create** stays disabled with "LinkedIn Ads: fix the ad variant text." Shorten or fill in the text to continue. Longer text is not cut for you.

## Add or remove variants

- Select **Add variant** to add an empty variant at the end, then write its intro text and headline. You can have up to 15 variants, LinkedIn's limit on active ads in a campaign. **Add variant** is disabled at 15.
- Select **Remove variant** on a variant to delete it. A campaign needs at least one variant, so **Remove variant** is disabled when only one is left.

If the brief holds more than 15 variants, **Create** stays disabled until you remove enough of them.

## Give each variant its own image

When LinkedIn ad images are available on your deployment, each variant has an **Image** picker. The image you choose is used only for that variant's ad. A variant without an image is created without one.

- Choose a PNG or JPEG of up to 5 MB, at least 640x360 (horizontal), 360x360 (square) or 360x640 (vertical). A file of another type or over 5 MB is refused before it uploads.
- The brief must be saved first. The pickers are disabled while the brief has not been saved or is saving.
- One image uploads at a time. While a variant's image is uploading, or its upload has failed, the other variants' pickers are disabled with a note naming that variant. **Create** waits until the upload finishes.
- **Cancel upload** stops an upload in progress, and **Remove uploaded image** takes the image off that variant. Removing a variant also cancels its upload.

Your edits and images are kept when you switch to another tab and back, as long as you stay on the same event.

### Image notices

**Create** stays disabled while a variant shows one of these notices under its picker. Each notice has a **Remove image** button, and the failed check also has **Retry**:

- The upload did not complete. Remove it, or choose the image again.
- The image was uploaded for a different brief. Remove it, then upload it again.
- LinkedIn ad images are not available on this deployment. Remove the image to create the campaign without it.
- LinkedIn ad image support could not be confirmed. Retry the check, or remove the image.
- LinkedIn ad image support can't be checked until the brief is saved. Save the brief, or remove the image.
- Checking LinkedIn ad image support…, shown while the check runs.
