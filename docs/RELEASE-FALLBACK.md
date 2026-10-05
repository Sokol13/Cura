# Historical v0.3.0 publication fallback

The user authorized milestone tags and Releases only after the milestone completion definitions and CI are verified. If the interactive GitHub credential cannot publish them, `.github/workflows/release-fallback.yml` can use the repository's Actions token. This fallback adds no new release authorization and does not weaken the acceptance checklist.

For v0.3.1 and later desktop-feedback releases, use the normal annotated-tag `release.yml` path after all milestone checks and main CI pass. The recovery script below is intentionally pinned to v0.3.0 and cannot publish a newer version; do not reactivate it for these milestones.

The fallback is inactive unless the successful CI commit contains `.github/release-request.json`. The current main branch does **not** include that file; its consumed copy remains in the immutable v0.3.0 tag. The coordinator creates it only after all v0.3.0 acceptance evidence is complete, including inherited milestones, live provider/cloud checks, independent FCPXML validation, documentation and known platform limits.

## Historical activation procedure

1. Complete and review the milestone acceptance report. Set the root, server, shared and web package versions to `0.3.0` before calculating tree hashes.
2. Add this exact readiness line to `docs/REPORT-v0.3.0.md` only after its completion checklist is satisfied:

   ```html
   <!-- cura-release-ready: v0.3.0 -->
   ```

3. Read the full committed package tree hashes. The hashes include source, migrations, tests, configuration and package versions:

   ```sh
   git rev-parse HEAD:packages/server
   git rev-parse HEAD:packages/shared
   git rev-parse HEAD:packages/web
   ```

4. The coordinator may then create `.github/release-request.json` using the following shape. Replace every placeholder with its corresponding 40-character Git tree hash. This documentation example is not an active request:

   ```json
   {
     "schemaVersion": 1,
     "tag": "v0.3.0",
     "ready": true,
     "report": "docs/REPORT-v0.3.0.md",
     "productionTrees": {
       "server": "REPLACE_WITH_SERVER_PACKAGE_TREE_HASH",
       "shared": "REPLACE_WITH_SHARED_PACKAGE_TREE_HASH",
       "web": "REPLACE_WITH_WEB_PACKAGE_TREE_HASH"
     }
   }
   ```

5. Commit the report/request on main and let normal CI finish. Do not change the package trees after capturing the hashes. A failed, cancelled, pull-request, fork, non-main or superseded CI run cannot publish. The fallback reads the committed request, versions and report from the exact successful CI SHA, not untracked files or an earlier build artifact.
6. Verify the fallback job and the published Release. Remove the consumed request in the next documentation commit. Leaving it present on later main commits fails closed because the existing immutable tag targets the previous release SHA; it never retags a newer commit.

The fallback workflow must already be present on the default branch for GitHub to deliver its `workflow_run` event. The triggering workflow must be named `CI` at `.github/workflows/ci.yml`. Its complete successful conclusion is the prerequisite, including full standard and real-cloud checks on both Node 22 and Node 24. The fallback publisher remains a single job; it does not run once per matrix cell. The fallback does not replace CI with an abbreviated build or claim hosted checks ran when they did not.

## Publication and recovery

The guarded job checks out `workflow_run.head_sha`, uses the default Node 22 pin without installing project dependencies, and grants `contents: write` only to that job. It validates the event's repository identity, push/main origin, successful completed status, checkout SHA, all four versions, exact report readiness marker and the three package trees.

The script observes remote main immediately before tag creation, tag push and release creation. It creates an annotated `v0.3.0` tag with the Actions bot identity, pushes only that ref without force, and verifies its remote target before running `gh release create --verify-tag --generate-notes`. Main and Release APIs cannot be locked atomically together; these adjacent checks detect observed branch changes and never move an existing tag.

Tags pushed using `GITHUB_TOKEN` do not trigger the existing tag-push Release workflow. This fallback therefore creates the GitHub Release in the same job, relying on the complete successful CI run for the exact source being tagged. No personal token, app secret, dispatch permission or new credential is required. Git authentication comes from `actions/checkout`; `gh` receives only the job's `github.token` through `GH_TOKEN`.

If publication is interrupted after the tag push, rerunning the fallback for the same successful CI SHA creates the missing Release without changing the tag. If the correct tag and a published stable Release already exist, rerunning is a no-op. A different tag target, orphaned Release, draft, prerelease, API/authentication/network failure, changed main or stale readiness evidence stops the job. Correct the actual cause; do not force a tag or reinterpret a failed command as a missing Release. If main has moved, preserve the existing tag and resolve the failed publication explicitly rather than submitting a new commit under the same version.

All commands use `execFileSync` argument arrays. Subprocess output is captured and omitted from failure messages so authentication diagnostics cannot disclose credentials. Tests use an injected command seam and never create actual tags, call GitHub or publish Releases. Run them with `node --test scripts/release-from-ci.test.mjs`; they also run under `pnpm test` and CI.

## Verified publication

The fallback published annotated v0.3.0 at `d90a567` after CI 37211290714 passed both core and real-cloud jobs. Publication workflow 37211646421 succeeded; remote tag target and stable GitHub Release were independently verified. The consumed request was then removed from main.
