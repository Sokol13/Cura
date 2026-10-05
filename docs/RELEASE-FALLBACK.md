# Gated v0.4.0 publication fallback

The user authorized milestone tags and Releases only after the milestone completion definitions and CI are verified. If the interactive GitHub credential cannot publish them, `.github/workflows/release-fallback.yml` can use the repository's Actions token. This fallback adds no new release authorization and does not weaken the acceptance checklist.

The current interactive GitHub credential has expired. The connected GitHub app can publish an exact commit/tree to main, but cannot create the milestone tag or Release. The coordinator therefore authorized adapting this existing fallback specifically for v0.4.0. The script accepts only that version; it is not a general release dispatcher. The normal annotated-tag `release.yml` path remains available when a working tag-push credential is present.

The fallback is inactive unless the successful CI commit contains `.github/release-request.json`. This preparation does **not** add that file, change package versions, mark the report ready or publish anything. Only the coordinator may activate it after all items 10–15 and inherited milestone requirements are complete, the final source and upgrade/clean-start evidence are reviewed, and documentation accurately records unverified physical macOS/Windows checks. Preparing this mechanism is not evidence that those acceptance gates have passed.

## Activation procedure

1. Complete and review the milestone acceptance report and final source. Set the root, server, shared and web package versions to `0.4.0` before calculating tree hashes. Finish the required local acceptance on that final candidate.
2. Add this exact readiness line to `docs/REPORT-v0.4.0.md` only after its completion checklist is satisfied:

   ```html
   <!-- cura-release-ready: v0.4.0 -->
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
     "tag": "v0.4.0",
     "ready": true,
     "report": "docs/REPORT-v0.4.0.md",
     "productionTrees": {
       "server": "REPLACE_WITH_SERVER_PACKAGE_TREE_HASH",
       "shared": "REPLACE_WITH_SHARED_PACKAGE_TREE_HASH",
       "web": "REPLACE_WITH_WEB_PACKAGE_TREE_HASH"
     }
   }
   ```

5. Commit the report/request on main and let normal CI finish. When using the connected app, publish the exact reviewed blobs/tree with a non-forced main update and verify the remote commit's root tree equals the local candidate's root tree. The remote commit SHA may differ from the local commit SHA; the remote SHA must receive all CI checks and is the only SHA the workflow may tag. Do not change the package trees after capturing the hashes, and keep main fixed until publication finishes. A failed, cancelled, pull-request, fork, non-main or superseded CI run cannot publish. The fallback reads the committed request, versions and report from the exact successful CI SHA, not untracked files or an earlier build artifact.
6. Verify the fallback job, annotated remote tag and published stable Release all identify that successful CI SHA. Remove the consumed request in the next documentation commit and verify its CI; this makes subsequent fallback runs inactive again. Leaving it present on later main commits fails closed because the existing immutable tag targets the previous release SHA; it never retags a newer commit.

The fallback workflow must already be present on the default branch for GitHub to deliver its `workflow_run` event. The triggering workflow must be named `CI` at `.github/workflows/ci.yml`. Its complete successful conclusion is the prerequisite, including full standard and real-cloud checks on both Node 22 and Node 24. The fallback publisher remains a single job; it does not run once per matrix cell. The fallback does not replace CI with an abbreviated build or claim hosted checks ran when they did not.

## Publication and recovery

The guarded job checks out `workflow_run.head_sha`, uses the default Node 22 pin without installing project dependencies, and grants `contents: write` only to that job. It validates the event's repository identity, push/main origin, successful completed status, checkout SHA, all four versions, exact report readiness marker and the three package trees.

The script observes remote main immediately before tag creation, tag push and release creation. It creates an annotated `v0.4.0` tag with the Actions bot identity, pushes only that ref without force, and verifies both its object ref and peeled commit target before running `gh release create --verify-tag --generate-notes`. A lightweight tag is rejected even if it points to the tested commit or already has a Release. Main and Release APIs cannot be locked atomically together; these adjacent checks detect observed branch changes and never move an existing tag.

Tags pushed using `GITHUB_TOKEN` do not trigger the existing tag-push Release workflow. This fallback therefore creates the GitHub Release in the same job, relying on the complete successful CI run for the exact source being tagged. No personal token, app secret, dispatch permission or new credential is required. Git authentication comes from `actions/checkout`; `gh` receives only the job's `github.token` through `GH_TOKEN`.

If publication is interrupted after the annotated tag push, rerunning the fallback for the same successful CI SHA creates the missing Release without changing the tag. If the correct annotated tag and a published stable Release already exist, rerunning is a no-op. A lightweight tag, different tag target, orphaned Release, draft, prerelease, API/authentication/network failure, changed main or stale readiness evidence stops the job. Correct the actual cause; do not force a tag or reinterpret a failed command as a missing Release. If main has moved, preserve the existing tag and resolve the failed publication explicitly rather than submitting a new commit under the same version.

All commands use `execFileSync` argument arrays. Subprocess output is captured and omitted from failure messages so authentication diagnostics cannot disclose credentials. Tests use an injected command seam and never create actual tags, call GitHub or publish Releases. They cover strict v0.4.0 request/report/version/tree checks, CI provenance, stale main, annotated-only recovery, idempotence and failures. Structural checks preserve the four mandatory standard/real-cloud Node 22/24 cells and single publisher with job-scoped write access. Run them with `node --test scripts/release-from-ci.test.mjs`; they also run under `pnpm test` and CI.

## Historical publication

The fallback published annotated v0.3.0 at `d90a567` after CI 37211290714 passed both core and real-cloud jobs. Publication workflow 37211646421 succeeded; remote tag target and stable GitHub Release were independently verified. The consumed request was then removed from main.

The v0.3.1 release used the normal annotated-tag path. The v0.4.0 adaptation and its tests do not claim that v0.4.0 has been activated or published; its report records the final outcome after verification.
