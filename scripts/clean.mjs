// Removes what the build generates, so the next build starts from nothing: the copies under
// src/ and any unsigned zips left in web-ext-artifacts/. Signed `.xpi` files are releases, not
// build output, and are left alone.
//
//   npm run clean
//
// `npm run sign` does this itself before copying.

import { cleanPackage } from "./package-assets.mjs";

const removed = await cleanPackage();
if (removed.length === 0) console.log("nothing to clean");
else for (const path of removed) console.log(`removed ${path}`);
