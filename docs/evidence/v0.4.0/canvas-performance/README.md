# Canvas idle and CDP baseline

Measured on 2026-10-05 in Linux x64, Node 22.23.3, headless Chromium 151.0.7922.173 with SwiftShader. This generated fixture did not reproduce the reported physical Windows screenshot freeze. Emulated DPR 1.25 is not evidence about native Windows display scaling or a physical GPU.

The production source was unchanged. Each case has a bounded warm-up, 15 seconds of untouched idle observation, then ten serial viewport CDP captures at approximately one-second intervals. Trace, video and automatic screenshots are off. Gates remain idle p95 <34 ms, maximum <100 ms, no Long Task ≥100 ms, and every capture <3 seconds. The 90-second test ceiling and five-second action limit bound failures; this spec has no retries.

| Case / raw evidence                                 | Idle p50 / p95 / max (ms) | Capture p50 / max (ms) | Captures |
| --------------------------------------------------- | ------------------------- | ---------------------- | -------- |
| [100-node canvas](canvas.json)                      | 16.7 / 16.8 / 16.8        | 104.24 / 118.60        | 10       |
| [Slot history comparison](history.json)             | 16.7 / 16.8 / 16.8        | 186.36 / 220.73        | 10       |
| [10×10 matrix](matrix.json)                         | 16.7 / 16.7 / 16.8        | 145.91 / 195.01        | 10       |
| [Canvas, emulated DPR 1.25](canvas-fractional.json) | 16.7 / 16.7 / 16.8        | 109.46 / 119.97        | 10       |

All four cases observed 899 idle requestAnimationFrame intervals, zero Long Tasks, zero observed canvas DOM mutations/ResizeObserver callbacks, and zero CDP layout/style recalculations. Each made only seven or eight bounded empty preview-queue GETs, with concurrency at most one and no board revision changes. These are callback intervals and separate activity/CPU proxies, not measured paint frequency or React commit counts. The production build exposes no React counter; raw evidence records `null`, not zero. Capture-load samples and CDP deltas are separate from idle samples. CDP duration deltas are in seconds; heap deltas are bytes.

The fixture uses 20 distinct PNG assets and 22 retained versions. Its 100 canvas nodes are 80 asset instances, ten text nodes, five groups and five filled slots, with 20 edges. Every slot has A/V1 → B/V2 → A/V1 history, while A's current version is V2. The matrix has 100 filled DOM cells and 100 decoded images; only 20 slots and 15 images intersected the viewport. DOM rectangle intersection does not account for dialog occlusion. Fixture counts, decoded/viewport image counts, raw intervals, per-second observer counts, requests, board revisions, GPU metadata and capture hashes are in each JSON.

## Provenance and harness corrections

The first three passing cases are preserved exactly from `742e8685eb7b51df192cd889a68b226c2029265f`, harness SHA-256 `5e881c95892a0089892d4eaa1d1b5fde9eecf97fdd69573e01e34b4f5c578362`. The final fractional case is from `057f34c5f3c53d24e8ed7585b9f912a85ee10d93`, harness SHA-256 `067f679a2bb52c629e4ba4c45339a275d759ff468b15a2226bb7557c4bda8d52`. The harness hash concatenates the spec, fixture and metrics helper in that order. Runtime dirty paths were rejected before measurement. Both source commits have identical production trees:

- `packages/web`: `8a5706b425c63077dfb951a69df8039a5c01c121`
- `packages/server`: `29dbdd46db0d263f90518be34c6d6a7239d8662f`
- `packages/shared`: `1ab30e200ca9757f055beb5ab5a5ff6ced13f3f5`

Before measurement, harness setup mistakes were corrected: the application uses the accessible “Fit board” button, not ReactFlow's built-in control class; the preview API returns `{items: []}`; two offscreen lazy tray images intentionally remained unfetched, so warm-up now decodes all board images and other viewport images rather than awaiting unrelated offscreen tray images. A setup-only `/favicon.ico` 404 is retained as raw console evidence and specifically classified; application errors are still gated. None of these attempts reached idle sampling.

The [first fractional attempt](fractional-first-attempt.json) passed idle observation and returned one valid 1500×1000 PNG in approximately 109 ms. It failed the harness's assumed 1875×1250 dimension assertion, not the capture deadline; the renderer remained responsive. Its PNG was not retained, so only its recorded dimensions/hash/timing are available. A [six-capture control](cdp-dimensions.json) subsequently confirmed that this separate raw CDP session returns the full 1500×1000 surface at both page DPRs. All four colored viewport corners are present. Explicit clip scale 1 preserves that surface; scale 1/DPR instead shrinks the output to 1200×800 at DPR 1.25. The final assertion therefore checks the observed surface dimensions separately from `window.devicePixelRatio`. Capture calls and performance thresholds were unchanged; only the fractional case was rerun. The final harness also retains returned first/last PNGs before dimension assertions and calls its diagnostic `rendererAfterFailure` rather than implying every failure is a timeout.

[First/last screenshot manifest](screenshots.json) maps all eight PNGs to the exact SHA-256 values in the raw JSON. Each case's first and last image is byte-identical. No private user fixture, account or credential appears in these generated-fixture artifacts; raw metric values were not changed. Local source SHAs precede integration/publication; production tree hashes identify the measured runtime independently of later documentation commits.

## Reproduce

From a normal installed checkout on Node 22 or 24:

```sh
pnpm build
pnpm exec playwright test e2e/canvas-performance.spec.ts --project=chromium --workers=1 --retries=0
```

On a physical Windows machine, use `pnpm.cmd` and append `--headed`, keeping the browser foreground throughout the measurement. The same generated fixture and controlled DPRs are tested; reproducing the user's original board/device remains a separate observation. Raw JSON is written to each `test-results` case directory and attached to the Playwright report; the report also retains explicit first/last captures. Normal `pnpm e2e` includes all four cases unchanged.

The independent static-page capture control can be reproduced without starting Cura:

```sh
node docs/evidence/v0.4.0/canvas-performance/cdp-dimensions.mjs .tmp/canvas-cdp-control
```

The archived control's imports/output directory were adapted for this permanent location; the six capture calls, DPRs and pixel-corner checks are unchanged. Control timing is not application performance evidence. The original failed measurement remains archived; these results are not a best-of retry selection. Complete Node 22/24 integration results are recorded separately by the release verification.
