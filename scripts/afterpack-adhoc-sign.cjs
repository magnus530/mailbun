// electron-builder afterPack hook: ad-hoc code-sign the macOS .app.
//
// We have no Apple Developer ID, so signing is otherwise skipped
// (mac.identity: null) and the app ships completely unsigned. On Apple
// Silicon, Gatekeeper reports an unsigned *downloaded* app as "damaged and
// can't be opened" — with no right-click bypass. An ad-hoc signature ("-") is
// untrusted but satisfies the "must be signed" requirement, downgrading that
// to the normal "unidentified developer" prompt that right-click → Open
// clears. Not a substitute for Developer ID + notarization; it just makes an
// unsigned test build runnable without Terminal gymnastics.
//
// Runs after the app is fully packed and before the dmg/zip are built, so the
// signature is what ends up in the shipped artifacts. No-op on non-mac builds.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  // --deep signs the nested Electron Framework, helpers, and the unpacked
  // better-sqlite3 native module. Enough for an ad-hoc signature; a real
  // Developer ID build would sign inside-out with hardened runtime instead.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
    stdio: "inherit",
  });
  console.log(`[afterPack] ad-hoc signed ${app}`);
};
