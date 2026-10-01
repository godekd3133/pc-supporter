"use strict";

// embedded-postgres registers async-exit-hook handlers at import time:
//   add.hookEvent('exit');
//   add.hookEvent('beforeExit', 0);
// The 'beforeExit' handler finishes with `process.exit(0)`, which rewrites a
// pending `process.exitCode = 1` into a successful CI step (a failing smoke or
// Vitest run exits 0). The 'exit' handler invokes the shutdown hook without its
// callback, which rejects with `TypeError: done is not a function` and can flip
// a clean exit into a failure. Both must be removed so the real exit code is
// preserved; cleanup is handled explicitly by each caller's stop()/teardown.
function unhookEmbeddedPostgresExitMask() {
  const AsyncExitHook = require("async-exit-hook");
  if (!AsyncExitHook || typeof AsyncExitHook.hookedEvents !== "function") return;
  for (const event of ["beforeExit", "exit"]) {
    if (AsyncExitHook.hookedEvents().includes(event)) AsyncExitHook.unhookEvent(event);
  }
}

module.exports = { unhookEmbeddedPostgresExitMask };
