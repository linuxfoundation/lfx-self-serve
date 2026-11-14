---
title: LinkedIn targeting and ad variants
description: See and narrow what a LinkedIn targeting profile targets, edit each ad variant's intro text and headline, name each ad and give it a description and call to action, add or remove variants, and give each variant its own image on the Campaigns page's Implement tab.
audience: [executive-director]
product_area: Dashboards
tags:
  [
    campaigns,
    paid marketing,
    linkedin ads,
    sponsored content,
    targeting,
    member groups,
    skills,
    ad variants,
    intro text,
    headline,
    ad name,
    description,
    call to action,
    images,
    implement,
  ]
last_updated: 2026-11-14
intercom_collection: Dashboards
---

When you create a LinkedIn campaign from the **Campaigns** page in the Foundation lens, each ad variant in the LinkedIn section becomes its own ad in the campaign. The **Implement** tab fills the variants in from the brief, and you can edit each one's intro text and headline, add or remove variants, and give each variant its own image. You can also see what the chosen targeting profile targets and take entries out of it.

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

Spaces at the start and end are not counted. An em dash (—) or en dash (–) is sent as a comma and a space, and counted that way, so the count can differ from what you typed. A dash at the very start or end is dropped.

Both fields are required. If a field is empty, holds only spaces or a single dash, or is over its limit, a message appears under it and **Create** stays disabled with "LinkedIn Ads: fix the ad variant text." Shorten or fill in the text to continue. Longer text is not cut for you.

## Name an ad, and add a description and call to action

When they are available on your deployment, each variant also has these optional fields:

- **Ad name**: the name of the variant's ad in LinkedIn Campaign Manager and in reports. It is not shown to people who see the ad. Up to 255 characters; runs of spaces count as one. Left blank, the ad is named after the event, such as "KubeCon EU 2026 | variant-2".
- **Call to action**: the button on the ad, which links to the registration page. Choose one from the list, such as Register, Sign up or Learn more, or leave it on **None** for no button. This field is offered only where LinkedIn calls to action have been turned on.
- **Description**: the line of text under the link card's headline. Up to 300 characters, counted like the intro text.

Each ad in a campaign needs its own name. If two variants have the same name, or a name matches another variant's default name, a message appears under it and **Create** stays disabled with "LinkedIn Ads: fix the ad variant text." The same happens when a name or description is over its limit.

If a saved brief holds a name, description or call to action that is no longer available on your deployment, the field stays visible with a message asking you to clear it, or to choose **None** for the call to action, and **Create** stays disabled until you do.

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

## Targeting profile

The **Targeting Profile** buttons in the LinkedIn section choose who sees the ads: **Cloud Native / CNCF** or **AI / MCP**. The brief picks one to start with. Under the buttons, the section lists what the chosen profile targets:

- **Member groups**: LinkedIn groups, shown by their LinkedIn ID (for example `urn:li:group:12345`).
- **Skills**: LinkedIn skills, shown by their LinkedIn ID (for example `urn:li:skill:12345`).

In the chosen locations, LinkedIn shows the ads to members who are in any of these groups, have any of these skills, or work in one of a fixed set of job functions. The campaign service adds the same job functions to every LinkedIn campaign, and they can't be changed here. Each heading shows how many entries this campaign keeps, then the profile's total, for example **Member groups (1 of 2)**.

### Remove entries

When targeting changes are available on your deployment, each group and skill has a remove button (×). Removing one takes it out of this campaign only. The profile itself does not change.

- **Reset to profile** puts back everything you removed. It appears once you have removed something.
- Choosing the other profile starts again from that profile's full list, so anything you removed is put back. If the brief chose a custom profile, neither button is selected, but the lists show Cloud Native / CNCF's groups and skills, which is what LinkedIn uses. Choosing Cloud Native / CNCF then keeps your removals.
- If you remove every group and skill, a note says the campaign reaches everyone in those job functions in the chosen locations. You can still create the campaign.
- You can't add groups or skills. Only entries already in the profile can be kept or removed.

Your removals are kept when you switch to another tab and back on the same event. Generating a brief for another event starts from the full profile.

If targeting changes aren't available, the lists are shown without remove buttons. **Create** stays disabled while removals you made earlier can't be sent: "LinkedIn Ads: targeting changes are not available right now. Reset the targeting profile." If the profile's details didn't load, the section says so, and **Create** stays disabled while you hold removals until you reload the page or select **Reset to profile**.
