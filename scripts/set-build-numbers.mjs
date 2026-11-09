#!/usr/bin/env node
/**
 * Derives the store build numbers from app.json's "version" (used by the release workflow):
 *   1.2.3 → Android versionCode 10203, iOS buildNumber "10203".
 * Android only installs an update over an older install when versionCode goes up, so it
 * must grow with every release; deriving it from the version keeps one source of truth.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../app.json', import.meta.url);
const app = JSON.parse(readFileSync(path, 'utf8'));
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(app.expo.version);
if (!m) throw new Error(`app.json version "${app.expo.version}" must look like 1.2.3`);
const [major, minor, patch] = m.slice(1).map(Number);
if (minor > 99 || patch > 99) throw new Error('minor and patch must be 0-99');
const code = major * 10000 + minor * 100 + patch;
app.expo.android = { ...app.expo.android, versionCode: code };
app.expo.ios = { ...app.expo.ios, buildNumber: String(code) };
writeFileSync(path, JSON.stringify(app, null, 2) + '\n');
console.log(`version ${app.expo.version} → versionCode ${code}`);
