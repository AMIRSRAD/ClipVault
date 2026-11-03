// Builds latest.json, the manifest the in-app updater reads from the GitHub release.
//
//   node scripts/make-update-manifest.mjs [notes-file]
//
// Run it after `pnpm tauri build` with the signing key set (see docs/RELEASE_CHECKLIST.md).
// It reads the version from tauri.conf.json and the installer signature from the .sig file
// the build wrote next to the NSIS setup, and writes latest.json next to the installer.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = config.version;
const repo = "AMIRSRAD/ClipVault";

const bundleDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const installer = `ClipVault_${version}_x64-setup.exe`;
const signaturePath = join(bundleDir, `${installer}.sig`);
if (!existsSync(signaturePath)) {
  console.error(`Missing ${signaturePath}. Build with TAURI_SIGNING_PRIVATE_KEY_PATH set.`);
  process.exit(1);
}

const notesFile = process.argv[2];
const notes = notesFile ? readFileSync(notesFile, "utf8").trim() : `ClipVault ${version}`;

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(signaturePath, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/v${version}/${installer}`
    }
  }
};

const out = join(bundleDir, "latest.json");
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${out}`);
