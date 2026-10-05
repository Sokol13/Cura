# Archive heartbeat CI investigation

[CI 37298894565](https://github.com/Sokol13/Cura/actions/runs/37298894565) reported a **313.082 ms** maximum heartbeat gap on Node 22 against the existing **less than 250 ms** requirement. Its source checkpoint `c33e13e` changed documentation only after green `ac39786`. The stall was **not reproduced locally**, and no production defect or fix is claimed. The [numeric evidence](archive-responsiveness-diagnostics.json) preserves exact source identities and selected raw measurements.

## Investigation

The existing test creates all 1,000 assets before starting its 5 ms heartbeat. It times preview and queue creation, then polls the real job every 5 ms until completion. Production archives 20 assets per SQLite transaction and yields between transactions. Each transaction includes asset hydration, archive writes, full-text index refresh, proposal/change history, progress and rule persistence. Polling and transaction progress also validate the growing full job payload. The fixture disables automation scheduling and has no media event subscribers or running folder scans.

A first unchanged three-case run passed at 10:56:01 UTC, before the final confirmation that all sibling workloads had stopped; it is not presented as isolated performance evidence. Two subsequent probes ran once each with an explicitly exclusive CPU slot in `/workspace/cura-archive-heartbeat`, from exact `c33e13e` source. Temporary Vitest setup instrumentation measured method/SQL durations, whole transaction versus callback time, heartbeat gaps and garbage-collection entries. It was not retained as a product feature or a permanent profiling framework.

| Exclusive probe, Node 22.23.3/Linux                                   | Maximum heartbeat gap | Longest 20-asset transaction | Body of that transaction | Begin/commit remainder | Maximum GC pause |
| --------------------------------------------------------------------- | --------------------: | ---------------------------: | -----------------------: | ---------------------: | ---------------: |
| Original 1,000-asset workload, 10:57:45 UTC                           |             52.173 ms |                    48.200 ms |                47.824 ms |               0.376 ms |         5.133 ms |
| Same workload, supported large notes on first 20 assets, 11:00:53 UTC |            180.227 ms |                   174.359 ms |               166.861 ms |               7.498 ms |         5.414 ms |

The second probe authored exactly 100,000 characters of note text on each of the 20 lowest asset IDs using real `CatalogStore.updateAsset`; those IDs form the first archive batch. Its 136.451 ms setup ran before the original fixture returned and before the heartbeat started. It retained all 1,000 assets, the original job polling, assertions and timing limits. Both probes passed the existing first test. The larger supported metadata substantially increased synchronous transaction work, but neither probe crossed 250 ms. Full-text refresh contributed work; these measurements do not establish it as the cause of the separate CI spike.

## Retained change and validation

Commit `93fcc1b` changes only the original performance test. It prints one `ARCHIVE_RESPONSIVENESS` JSON record after clearing the heartbeat, on both acceptance and failure. Fields include preview/queue duration, maximum heartbeat gap, phase at each end of that gap, last job progress/status observed by the existing poll, and maximum existing job-read duration. There are no added database reads, sleeps, mocks or timers. Phase endpoints identify observations rather than the precise CPU stack responsible for a delay.

The 1,000-asset fixture, polling frequency, measured operations, completion checks, 200/200/250 ms timing gates and 20-second test timeout remain unchanged. Cancellation, partial history, concurrent final-owner protection and changed-rule checks also remain intact. There is no production batching, transaction, indexing or persistence change.

One exclusive validation run at 11:04:01 UTC passed all three original cases: preview **13.333 ms**, queue **11.747 ms**, maximum heartbeat **50.955 ms**, and maximum observed job read **5.027 ms**. The largest gap was observed during archive work, with the last poll at 620 processed; completion still reported all 1,000. Scoped ESLint, server TypeScript and Prettier passed.

Run the unchanged serial acceptance command to obtain the new evidence:

```bash
pnpm --filter @cura/shared build
pnpm --filter @cura/server exec vitest run test/automation-archive-performance.test.ts --maxWorkers=1
```

These are Linux source/runtime measurements, not physical Windows/macOS verification. The retained diagnostics support a subsequent normal CI check; a future green run does not retroactively identify the unreproduced stall's cause. Item 15 browser/frame/CDP work remained paused throughout this investigation.
