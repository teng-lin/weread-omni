# Local source build

This fork adds `public-accounts read-article URL` and the SDK helper
`readPublicAccountArticle` to the upstream 0.1.1 source. It is a local source
customization, not a new upstream npm release; the package version and upstream
release changelog still describe that baseline. The Git commit identifies the
local implementation.

Build and verify in the checkout:

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
node bin/weread-omni.js --help
```

`bin/weread-omni.js` is a tracked launcher for the compiled CLI. A user-owned PATH
symlink may point to it without editing the global npm package. The existing npm
package remains independently updateable and available for rollback. Do not run
the launcher before building, or after changing source without rebuilding.

Keep local changes committed. Before adopting an upstream change, compare and
merge it into this fork, resolve any conflicts, rebuild and run the tests and a
real article read. Do not replace the fork with a registry installation or reset
away the local commit. Source ownership and npm package freshness are separate:
an updated global package does not update this source launcher.

The new command shares the existing source retrieval, entitlement checks and
library with feed/export. It does not add a second request strategy. JSON reports
cache provenance and exposes existing storage timestamps without a schema
migration. It distinguishes readable content from verified full-text completeness;
an unavailable article produces structured stderr and a nonzero exit.

To roll back a user-owned launcher, restore its recorded previous symlink target.
The source checkout and fetched content can remain in place.
