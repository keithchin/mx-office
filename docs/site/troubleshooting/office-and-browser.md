---
title: Office and browser
description: Signing in, old pages after an update, projects missing after a restart, the GPU, and screenshots with Playwright.
weight: 3
---

## I can't sign in

- The password is in `~/.agent-office-password` (the launcher passes it to the office). Ask whoever looks after the office; never paste it in chat.
- Make sure you're on `http://127.0.0.1:4600`. Each port has its own sign-in cookie, so a test office on another port needs its own sign-in.

## The office doesn't open

Check `http://127.0.0.1:4600/api/health`. If it doesn't answer, start the office (see [Running the office](../administration/running-the-office.md)) and look at the PowerShell window for errors.

## Pages look old after an update

Press **Ctrl+F5** to reload without the cache.

## Projects are missing after a restart {#floors-are-missing-after-a-restart}

This was a bug (the team hook broke project start-up) and is fixed. If it happens again, check the Mx Office window for errors, and that the project folders still exist.

## The 2D Office view is slow

- Use the **1D** view for daily work; the 2D Office view is for looking at the project.
- Make the browser use the fast GPU. On the office laptop, Edge is set to the NVIDIA GPU (Windows Settings → Display → Graphics).
- The 3D and Retro views (and `?gfx=`) are gone: an old `/?view=3d` link opens the 1D view.

## The desktop app won't start again after Quit

**Cause:** an older desktop app, once quit, could stay behind as an `mx-office.exe` without a window or tray icon (a Live app window's page had cancelled the quit), and every new start handed over to it, so nothing appeared.

**Fix:** update the office and run `npm run desktop:pack` again. To clear one left from before, end the leftover `mx-office.exe` in Task Manager (Details), then start the app. With the current app, Quit leaves no process behind, and if something ever holds on, `desktop-office.log` says what (*desktop app: quit: still running…*).

## Notifications don't appear

Click **🔔** in the top bar to allow them, and check that Windows allows notifications from your browser.

## Headless Edge is blocked

On the office laptop, headless Edge is blocked by policy. For Playwright screenshots, use `playwright-core` with the **bundled Chromium** instead (under `%LOCALAPPDATA%\ms-playwright\`).
