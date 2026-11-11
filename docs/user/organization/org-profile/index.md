---
title: Organization Profile
description: How to read and edit the Organization lens Organization Profile page — the organization's logo, description, website, employees, industry, sector and addresses, who can edit them, how to save changes, and how to upload a new logo.
audience: [all]
product_area: Organization
tags: [organization, org, org-lens, profile, organization-profile, logo, website, crunchbase, industry, sector, address, edit]
last_updated: 2026-11-11
intercom_collection: Organization
---

These steps apply to anyone who can open an organization in the Organization lens, such as an organization admin (editor or viewer). Only someone who can edit the organization, such as an **Org Admin Editor**, can change the profile. A CLA (Contributor License Agreement) Manager or initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager) with no other role on an organization sees only its **EasyCLA** page, not **Organization Profile**. To pick the organization the page shows, see [Choose and switch an organization](../choose-an-organization/). The page is about one organization, so it is not part of a family roll-up: while a roll-up is selected, **Organization Profile** is not in the menu.

## What is the Organization Profile page?

The Organization Profile page shows the selected organization's details: its logo, name, description, website, number of employees, industry, sector and addresses. Anyone who can open the organization in the Organization lens can see it, except a CLA Manager or initial CLA Manager designee with no other role on it. Its address is `/org/<organization>/profile`.

The top card shows:

- The organization's logo, or a **No logo** box when it has none.
- The organization's name. Next to it, a globe icon opens its website and a **cb** icon opens its profile on Crunchbase, a public company-information site, when those are set.
- The organization's description.
- **Website:**, **Employees:**, **Industry:** and **Sector:**.
- **Last Updated:**, the date the organization's record last changed.

Below it, two cards show the **Primary Address** and the **Billing Address**: the street, the city with its state or province and postal code, and the country. A detail the organization does not have shows as **—**, and so does an address card with no address.

## How do I open the Organization Profile?

You open **Organization Profile** from the Organization lens sidebar, once an organization is selected.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Organization** in the lens switcher.
3. In the sidebar, below the **Organization Engagement** section, select **Organization Profile**. On a phone or small screen, selecting **Organization** in the navigation menu only shows that lens's menu: select **Organization Profile** in it.

If your only role on that organization is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).

When you cannot open the organization, the page is replaced by the same access message as the other Organization lens pages, such as **You do not have access to this organization**. Those messages are covered in [What happens when a link does not open an organization?](../choose-an-organization/#what-happens-when-a-link-does-not-open-an-organization).

## Who can edit the organization profile?

You can edit the organization profile when you can edit the organization, for example as an **Org Admin Editor**, including one inherited from a related organization. Only then does the page show **Edit Profile**, under **Last Updated:**.

An **Org Admin Viewer** sees the same profile without **Edit Profile**. Every save is checked again when you select **Save Changes**, so if your access was removed after you opened the page, the save is refused with **Permission denied**. For what each role in the organization switcher means, see [What does my role in the organization switcher mean?](../choose-an-organization/#what-does-my-role-in-the-organization-switcher-mean).

## How do I edit the organization profile?

You edit the profile with **Edit Profile**, then save your changes with **Save Changes**. You must be able to edit the organization.

1. On **Organization Profile**, select **Edit Profile**.
2. Change any of these fields:
   - **Website**, such as `example.com`.
   - **Number of Employees**, a number of 0 or more.
   - **Crunchbase Profile**, which must be a secure address that starts with `https://`, such as `https://crunchbase.com/organization/company`.
   - **Industry**, chosen from the **Select Industry** list.
   - **Technology Sector**, chosen from the **Select Sector** list.
   - **Organization Description**, up to 2000 characters.
3. Select **Save Changes**.

**Save Changes** stays disabled until you change a field and every field is valid. When the save succeeds, the page returns to the profile and shows **Profile updated** — **Your organization profile has been saved.** Changes save to the organization's record, so everyone who can open the organization sees them.

To clear **Website**, **Number of Employees**, **Crunchbase Profile** or **Organization Description**, empty the field and save. **Industry** and **Technology Sector** can be changed but not cleared. A website saved without `http://` or `https://` opens with `https://`.

To leave without saving, select **Cancel**, or select **Profile** at the top of the form. Your unsaved changes are discarded. Switching to another organization also discards them.

If the organization's current industry or sector is not one of the choices, it still appears in the list, so saving another field does not change it.

## How do I change the organization's logo?

You change the logo by uploading an SVG (Scalable Vector Graphics) image file of 2MB or less while editing the profile. The logo saves as soon as it uploads, separately from **Save Changes**.

1. On **Organization Profile**, select **Edit Profile**.
2. Select **Upload Logo**, or select the logo box, and choose an SVG file. You can also drag the file onto the logo box.
3. Wait for **Logo updated!**. The new logo shows straight away.

Because the logo is saved on its own, selecting **Cancel** afterwards does not undo it. To change it again, upload another file.

The line under **Upload Logo** reads **SVG only, not more than 2MB. SVGs are sanitized; those using unsupported CSS may be rejected.** The file is sanitized (checked and cleaned) before it is stored, and an SVG whose CSS (Cascading Style Sheets, the styling inside the file) cannot be reproduced faithfully is rejected.

| Message                                                                                     | What it means                                   | What to do                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| **Logo rejected** — **Please choose an SVG image.**                                         | The file is not an SVG                          | Choose an SVG file                            |
| **Logo too large** — **Logo must be 2MB or smaller.**                                       | The file is larger than 2MB                     | Choose a smaller SVG file                     |
| **Logo rejected**, with a reason or **This image could not be used. Try a different file.** | The SVG cannot be used, and retrying won't help | Fix what the reason names, or use another SVG |
| **Upload failed**, with a reason or **Unable to upload logo. Please try again.**            | The upload did not complete                     | Try again                                     |
| **Permission denied** — **You no longer have permission to edit this organization.**        | You can no longer edit the organization         | Ask an **Org Admin Editor** to change it      |

## Why can't I edit the organization name or addresses?

The organization name and the addresses cannot be changed on the Organization Profile page.

- **Organization Name** is shown locked in the edit form. Next to it, **Need to edit? Contact Support** opens support, where you can ask for the name to be changed.
- **Primary Address** and **Billing Address** are shown only on the profile and are not part of the edit form.

## What do the Organization Profile error messages mean?

The Organization Profile page shows an error message when the profile does not load, a field is not valid, or a save fails, and each one says what went wrong. A failed save keeps your changes in the form, so you can try again.

| What you see                                                                                         | What it means                                       | What to do                                     |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| **Unable to load organization profile** — **There was a problem reaching the organization service.** | The profile did not load                            | Select **Retry**                               |
| **Number of employees must be 0 or greater.**                                                        | **Number of Employees** is below 0                  | Enter 0 or more                                |
| **Crunchbase URL must be a valid `https://` address.**                                               | **Crunchbase Profile** is not an `https://` address | Enter an address that starts with `https://`   |
| **Description must be 2000 characters or fewer.**                                                    | **Organization Description** is too long            | Shorten it                                     |
| **Save failed** — **Unable to save changes. Please try again.**                                      | The save did not reach the organization's record    | Select **Save Changes** again                  |
| **Save failed** — **Something went wrong while saving. Please try again.**                           | The save failed for another reason                  | Select **Save Changes** again                  |
| **Permission denied** — **You no longer have permission to edit this organization.**                 | Your edit access was removed                        | Ask an **Org Admin Editor** to make the change |

## Related sections

- [Choose and switch an organization](../choose-an-organization/) — pick the organization the page shows, and what your role in the switcher means
- [Manage Org Lens Access](../manage-org-lens-access/) — who is an Admin, and how to add one
- [EasyCLA](../easycla/) — corporate CLAs for the selected organization, just above **Organization Profile** in the sidebar
- [Organization FAQ](../faq/) — short answers about the Organization lens
