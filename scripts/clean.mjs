// Removes what the packaging generates, so the next build starts from nothing: the copies under
// src/ (the vendored runtime, the notices, the bundled checkpoint) and any unsigned zips left in
// web-ext-artifacts/. Signed `.xpi` files are releases, not build output, and are left alone.
//
//   npm run clean
//
// `npm run build` runs this first, and `npm run sign` runs the build.

import { cleanPackage } from "./package-assets.mjs";

const removed = await cleanPackage();
if (removed.length === 0) console.log("nothing to clean");
else for (const path of removed) console.log(`removed ${path}`);
