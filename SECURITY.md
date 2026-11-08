# Security policy

Scrimba Companion hosts your real Scrimba session in a WebView, so security reports are welcome.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private reporting instead: the repository's
**Security** tab → **Report a vulnerability**. Include the app version (Settings → About), your
Android version and Android System WebView version, and steps to reproduce.

You should get a reply within a week. Please give us a reasonable time to release a fix before
disclosing the issue.

## Scope

In scope: this app's code (the native app, the injected page runtime, build scripts and CI
workflows), and anything that lets a web page, another app or a modified APK read the Scrimba
session, the clipboard or stored data through the app.

Out of scope: vulnerabilities in scrimba.com itself (report those to Scrimba), in Android System
WebView or Chrome (report to Google), and issues that need a rooted phone or USB debugging with
the app's Developer mode turned on.

## Supported versions

Only the latest release gets security fixes.
