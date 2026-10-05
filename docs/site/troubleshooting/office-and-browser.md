---
title: Office and browser
description: Signing in, old pages after an update, floors missing after a restart, a slow 3D view and the GPU, and screenshots with Playwright.
weight: 3
---

## I can't sign in

- The password is in `~/.agent-office-password` (the launcher passes it to the office). Ask whoever looks after the office; never paste it in chat.
- Make sure you're on `http://127.0.0.1:4600`. Each port has its own sign-in cookie, so a test office on another port needs its own sign-in.

## The office doesn't open

Check `http://127.0.0.1:4600/api/health`. If it doesn't answer, start the office (see [Running the office](../administration/running-the-office.md)) and look at the PowerShell window for errors.

## Pages look old after an update

Press **Ctrl+F5** to reload without the cache.

## Floors are missing after a restart

This was a bug (the team hook broke floor start-up) and is fixed. If it happens again, check the Agent Office window for errors, and that the floor folders still exist.

## The 3D view is slow

- Use **1D** or **2D** for daily work.
- In 3D, add `?gfx=low`, or use the **Retro** view.
- Make the browser use the fast GPU. On the Taskforce laptop, Edge is set to the NVIDIA GPU (Windows Settings → Display → Graphics).

## Notifications don't appear

Click **🔔** in the top bar to allow them, and check that Windows allows notifications from your browser.

## Headless Edge is blocked

On the Taskforce laptop, headless Edge is blocked by policy. For Playwright screenshots, use `playwright-core` with the **bundled Chromium** instead (under `%LOCALAPPDATA%\ms-playwright\`).
