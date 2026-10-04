# Research

Research date: 2026-10-04. Scope: the Phase 1 architecture and interaction questions in `AGENTS.md`. This is a bounded review of upstream documentation, manifests, licenses, and metadata writers, not a product benchmark or a claim that the referenced applications were run. All recommendations are independent Cura designs; no upstream application code or visual assets are incorporated.

## Decisions supported by the research

1. Keep the existing Node/Fastify service, React browser client, SQLite catalog, and shared Zod contracts. Separate filesystem access and bounded background work from HTTP handlers; a distributed deployment is unnecessary for the local, single-user milestones.
2. Distinguish **registered folders** from **uploaded files**. Registered files remain in place; uploads become managed Inbox files. Cache, catalog, logs, and managed version snapshots belong in the application data directory. Registration does not authorize metadata sidecars, renaming, or deletion of originals.
3. Treat discovery, metadata extraction, and thumbnail generation as observable, retryable jobs. Show discovered assets immediately with a placeholder and update them through WebSocket events. Use content-based cache keys and reconcile watchers with a rescan.
4. Use the specified React Flow for boards and slots. Keep the asset library virtualized separately. Basic image annotations need an image-relative overlay; adding Konva is unnecessary until richer drawing requirements justify it.
5. Parse PNG metadata independently from documented wire formats. Support `tEXt`, `iTXt`, and bounded `zTXt`; distinguish SD WebUI text from ComfyUI execution graphs. Preserve raw fields, parsing warnings, provenance, and exact seeds.
6. Do not install `ffmpeg-static`: its GPL license conflicts with the permitted runtime package licenses. P1 can use browser video decoding to capture a frame through an HTTP-served asset, with an explicit unsupported-codec state. This does not promise every MOV/MP4 codec will work on every operating system.

## Architecture references

### Allusion

**Observed.** [Allusion's website](https://allusion-app.github.io/) describes watched folders, hierarchical tags, and combined searches over folders, tags, and metadata. Its [manifest](https://github.com/allusion-app/Allusion/blob/631cfb5fb9c3bb62677e5fd37be28dbfaf4b8e2f/package.json) identifies an Electron/React application with Dexie, chokidar, and worker-related dependencies. Its [thumbnail worker](https://github.com/allusion-app/Allusion/blob/631cfb5fb9c3bb62677e5fd37be28dbfaf4b8e2f/src/frontend/workers/thumbnailGenerator.worker.ts) demonstrates a queue with limited concurrent thumbnail work, cached outputs, and per-item failure handling. This is a desktop renderer/worker design, not a ready-made local HTTP server architecture.

**Adopt.** Reference files in place, watch registered roots, retain tag hierarchy, and bound processing concurrency. Model a failed thumbnail separately from a failed import so one unsupported file cannot stop the scan.

**Do not adopt.** Electron, browser database persistence, direct renderer filesystem access, or its decoder implementation. Cura's browser must work exclusively through the server API, including after a future desktop wrapper is introduced.

**License.** The repository [LICENSE](https://github.com/allusion-app/Allusion/blob/631cfb5fb9c3bb62677e5fd37be28dbfaf4b8e2f/LICENSE) is GPL-3.0. The inspected manifest misleadingly declares `ISC`; that field does not resolve the conflicting repository license. Treat the application as GPL-covered research material and do not reuse its code.

### TagSpaces

**Observed.** The [upstream README](https://github.com/tagspaces/tagspaces/blob/e137251f9cf3d315fc6ebfa3391b2f8d15435c23/README.md) describes offline file organization, tags stored in filenames or sidecars, and a React/Electron frontend. It explicitly describes a separate local web service for search indexing and thumbnail generation, protected by an instance communication key. Thus, “serverless” in its product description does not mean all desktop processing occurs inside the renderer.

**Adopt.** Local ownership of original files, a clear distinction between navigation and metadata, and a background service boundary for indexing and thumbnails. Cura's existing Host/Origin checks remain required even on loopback.

**Do not adopt.** Filename tag encoding or writing sidecars into registered roots. Those actions would change the user's files and conflict with Cura's in-place registration promise. Persist metadata in SQLite and make portable structure explicit in neutral exports.

**License.** [AGPL-3.0](https://github.com/tagspaces/tagspaces/blob/e137251f9cf3d315fc6ebfa3391b2f8d15435c23/LICENSE.txt); proprietary/paid editions do not grant reuse rights to their code. No TagSpaces source dependency is proposed.

### Immich

**Observed.** The upstream [architecture document](https://github.com/immich-app/immich/blob/69f06a29ca67613355348172480054ebd7e09f6c/docs/docs/developer/architecture.mdx) describes REST clients, a TypeScript/Nest server, repository boundaries, PostgreSQL, Redis-backed jobs, and a separate machine-learning service. The [worker document](https://github.com/immich-app/immich/blob/69f06a29ca67613355348172480054ebd7e09f6c/docs/docs/administration/jobs-workers.md) distinguishes API and microservices workers and explains that both can run in the server container, with optional separation. This is more precise than treating the older architecture diagram's container split as mandatory.

[External library documentation](https://github.com/immich-app/immich/blob/69f06a29ca67613355348172480054ebd7e09f6c/docs/docs/features/libraries.md) covers recursive import paths, exclusions, scheduled scans, and experimental watching. It warns that watching network drives may fail and that moved files can be treated as new assets, losing application-only metadata. It also documents read-only mounts as a protection for originals. Job ordering makes expensive downstream operations depend on previously produced metadata/thumbnails.

**Adopt.** Explicit library roots, resumable stages, idempotent work, clear job states, and reconciliation when filesystem events are missed. Keep stable asset/version identifiers independent of display paths. In Cura, a disconnected or inaccessible root is an availability problem, not proof that every asset should be deleted. A rescan must preserve notes, tags, and history for identified existing content.

**Do not adopt.** PostgreSQL, Redis, Docker, account requirements, remote ML downloads, or face recognition in P0. A local worker pool and SQLite job/catalog state cover the required 1,000-image acceptance case with fewer operational dependencies. Immich's scale is architectural evidence, not a measured Cura performance result.

**License.** [AGPL-3.0](https://github.com/immich-app/immich/blob/69f06a29ca67613355348172480054ebd7e09f6c/LICENSE). Learn from boundaries and documented behavior without copying implementation.

### PhotoPrism

**Observed.** The [directory guide](https://github.com/photoprism/photoprism-docs/blob/6f5d6bbb0acdc728cc7b9c2bd78bc1b83b389fb0/docs/developer-guide/directories.md) separates a Go backend, Vue/Vuetify frontend, and runtime storage. Its [import guide](https://docs.photoprism.app/user-guide/library/import/) clearly distinguishes indexing existing originals without renaming them from an optional copy/move import flow. The guide warns about incomplete files during automatic imports and uses a safety delay.

The [thumbnail guide](https://github.com/photoprism/photoprism-docs/blob/6f5d6bbb0acdc728cc7b9c2bd78bc1b83b389fb0/docs/developer-guide/media/thumbnails.md) describes pre-generated and on-demand sizes, thumbnails reused for analysis, and cached files keyed by original hash and rendition size. Its [storage guide](https://github.com/photoprism/photoprism-docs/blob/6f5d6bbb0acdc728cc7b9c2bd78bc1b83b389fb0/docs/developer-guide/media/storage.md) places media and thumbnail files in server-accessible storage.

**Adopt.** A visible distinction between registering and importing, debounce/stability checks before reading newly written files, small cached grid renditions, and a larger preview rendition. Cache keys should contain content hash, rendition profile, and processor version. Derived files can be rebuilt; originals and version snapshots cannot be treated as disposable cache.

**Do not adopt.** Go/Vue, its deployment requirements, import-time file renaming, or its many thumbnail sizes. Begin with a small fixed rendition set, measure it, and keep cache generation out of request handlers. Do not copy its branding or icons.

**License.** The [current LICENSE](https://github.com/photoprism/photoprism/blob/develop/LICENSE) contains AGPL-3.0 plus additional trademark/brand terms. GitHub's `NOASSERTION` summary is insufficient; the actual license was read. No application code or assets are reused.

## Documented interaction references

These commercial products are reference material only. Their documentation supports observations about behavior, not permission to copy software, visuals, text, or proprietary formats.

| Product and primary sources                                                                                                                                                                                              | Documented behavior                                                                                                                                                                                     | Cura use                                                                                                                                                           | Excluded or deferred                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eagle: [quick search](https://en.eagle.cool/support/article/quick-search), [category tool](https://en.eagle.cool/support/article/the-category-tool-f), [filters](https://en.eagle.cool/support/article/interface-filter) | Keyboard folder switching with fuzzy matching; a selected asset can be assigned through a category picker or inspector; a collapsible filter row includes color, tags, rating, type, size, and dates.   | Pair visible organization controls with shortcuts. Put combinable filters next to search. Show selection and active filters clearly.                               | Exact shortcut choices and rearrangeable filter controls are not required. Do not reproduce product branding or rely on an Eagle library format.                            |
| Billfish: [interface guide](https://www.billfish.cn/help), [search](https://www.billfish.cn/help/sousuochazhao), [asset markers](https://www.billfish.cn/help/tianjiabiaoji)                                             | Left folder/tag tree, central asset area, right inspector; hideable sidebars; search scopes of library or folder; metadata search, color copying, tag suggestions, notes, provenance URLs, and ratings. | Use Cura's specified three-column shell, explicit current-folder/library scope, tag suggestions, copyable colors, and editable metadata.                           | Do not implement filename changes merely because another product supports them: registered originals remain untouched.                                                      |
| PureRef: [navigation](https://www.pureref.com/handbook/2.0/navigation/), [images](https://www.pureref.com/handbook/2.0/images/)                                                                                          | Spatial reference canvas; pan/zoom; command search; drag/drop; selection; reversible focus view; arrow-key image stepping; access to original local/web source.                                         | P0: Space preview, arrows, and return to the prior grid position. P1: predictable pan/zoom, asset references on boards, command discovery, and persisted viewport. | Do not hide essential library controls exclusively behind context menus. Scene transforms must not modify original files. No PureRef file-format compatibility is promised. |

Eagle's [EULA](https://en.eagle.cool/eula), Billfish's [user agreement](https://www.billfish.cn/user-agreement), and PureRef's [license agreement](https://www.pureref.com/license.php) reserve proprietary software rights. Billfish's free download is not an open-source license or proof of unrestricted commercial use. The Billfish observations above are English summaries of its Chinese documentation.

## React Flow and Konva

| Question         | React Flow                                                                                                                                          | Konva                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Main abstraction | React components as nodes, edges, selection, viewport, and interaction state.                                                                       | Canvas scene graph containing stages, layers, shapes, images, and event handling.                                                       |
| Strong fit       | Asset cards, connected references, editable slots, groups, matrix cells, and ordinary accessible DOM controls.                                      | Freehand drawing, complex shape manipulation, raster-oriented editing, and many canvas primitives.                                      |
| Performance work | Memoize node/edge components and callbacks; avoid subscribing unrelated UI to every node change; simplify expensive styles and hide unneeded nodes. | Keep the stage viewport-sized, control layer count, disable unnecessary hit testing, cache complex shapes, and hide off-screen objects. |
| Persistence      | Save Cura-owned board items, links, and viewport; reconstruct React Flow state from those records.                                                  | Save domain records and reconstruct the scene; renderer serialization should not become the only export format.                         |
| License          | [MIT](https://github.com/xyflow/xyflow/blob/3d35b57317576b0916c0bfeaaedd573aaacc2839/LICENSE), including the open-source React Flow package.        | [MIT](https://github.com/konvajs/konva/blob/ca62a92ee60095803bf69abae29d92b936ee2eef/LICENSE).                                          |

Primary implementation guidance: [React Flow performance](https://reactflow.dev/learn/advanced-use/performance), [save and restore](https://reactflow.dev/examples/interaction/save-and-restore), [Konva React integration](https://konvajs.org/docs/react/Intro.html), and [Konva performance](https://konvajs.org/docs/performance/All_Performance_Tips.html).

**Cura decision:** React Flow remains the specified P1 board renderer. Each item references an asset or slot; it does not own a duplicate image. Slot replacement is a server transaction creating version lineage, not simply a changed image URL. Persist positions and viewport through the API. Use TanStack Virtual for the P0 library rather than rendering the full library as board nodes. Start P0 annotations with normalized image coordinates and DOM/SVG markers; Konva is a reviewed alternative, not an additional mandatory dependency. Neither library guarantees smooth operation with arbitrary numbers of full-resolution images; measure real boards separately from the 1,000-image library benchmark.

## PNG metadata: actual producer formats

### Container and text encoding

The [PNG specification](https://www.w3.org/TR/png-3/#11textinfo) defines the PNG signature and length/type/data/CRC chunks, including three text encodings:

- `tEXt`: a Latin-1 keyword, NUL separator, and Latin-1 text.
- `zTXt`: a keyword, NUL separator, compression method, and compressed Latin-1 text.
- `iTXt`: a keyword, NUL separator, compression flag/method, language tag, translated keyword, and UTF-8 text. Text may be compressed.

Both studied generators use Pillow's `PngInfo.add_text`. [Pillow's writer](https://github.com/python-pillow/Pillow/blob/main/src/PIL/PngImagePlugin.py) falls back to `iTXt` when a string cannot be represented as Latin-1. Consequently, a `tEXt`-only implementation can silently miss Chinese SD WebUI prompts. ComfyUI's default Python JSON serialization normally escapes non-ASCII text, but the container reader must still support all three encodings.

**Parser requirements:** verify signature and chunk bounds; verify metadata CRCs; stop safely on truncation; cap individual and aggregate text size and decompressed output; keep processing in the worker. Ignore unrelated chunks without decoding pixel data. Never evaluate workflow content or follow embedded paths/URLs. Return partial metadata plus warnings if one field is malformed; the image must remain importable. Preserve raw chunk values for supported metadata keys and report duplicates instead of silently merging conflicting payloads.

### Stable Diffusion WebUI / AUTOMATIC1111

The inspected [image writer](https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/82a973c04367123ae98bd9abdf80d9eda9b910e2/modules/images.py) saves generation text under the PNG keyword `parameters` when PNG information is enabled. The [infotext reader](https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/82a973c04367123ae98bd9abdf80d9eda9b910e2/modules/infotext_utils.py) recognizes a prompt, an optional `Negative prompt:` section, and a trailing parameter list. Fields are extensible; model name and model hash are different fields.

An original, synthetic example for Cura's fixture generator:

```text
studio photograph of a red ceramic cup
soft window light
Negative prompt: watermark, blur
Steps: 24, Sampler: Euler, CFG scale: 7, Seed: 424242, Size: 768x512, Model hash: abc123, Model: studio-v1
```

Map the first section to `prompt`, the negative section to `negative_prompt`, `Model` to `model`, `Seed` to an exact decimal string, and source to a stable SD WebUI identifier. Preserve the complete original text and unknown parameters in `params`. Keep `Model hash` separately; do not invent a model name from it. Parse multiline prompts and optional sections; locate a credible parameter footer rather than splitting the entire value at commas. Quoted values can contain commas, colons, and escaped quotes. The frontend must distinguish “no embedded metadata” from “metadata exists but could not be parsed.”

Source license: [AGPL-3.0](https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/82a973c04367123ae98bd9abdf80d9eda9b910e2/LICENSE.txt). Implement the wire-format parser independently; do not transplant its parsing implementation or regexes.

### ComfyUI

The inspected [`SaveImage` implementation](https://github.com/Comfy-Org/ComfyUI/blob/f1072eb0350638a3390ddb6afbcaa8c6b237c6fd/nodes.py) writes:

- `prompt`: JSON containing the **execution graph**, keyed by node ID. Each node has `class_type` and `inputs`; a graph link is commonly `[upstreamNodeId, outputIndex]`.
- Every key in `extra_pnginfo`: a separately JSON-serialized PNG text value. The familiar `workflow` entry is UI workflow state, including editor nodes/links and widget values. `SaveImage` itself does not require that a `workflow` entry exist.

Metadata can be disabled. Custom output nodes can omit or alter these fields, so “ComfyUI image” does not guarantee parseable generation details.

Original, simplified execution-graph fixture data:

```json
{
  "10": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "studio-v1.safetensors" }
  },
  "20": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "red ceramic cup", "clip": ["10", 1] }
  },
  "21": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "watermark", "clip": ["10", 1] }
  },
  "30": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 424242,
      "steps": 24,
      "cfg": 7,
      "model": ["10", 0],
      "positive": ["20", 0],
      "negative": ["21", 0]
    }
  },
  "40": {
    "class_type": "VAEDecode",
    "inputs": { "samples": ["30", 0], "vae": ["10", 2] }
  },
  "50": { "class_type": "SaveImage", "inputs": { "images": ["40", 0] } }
}
```

This fixture illustrates extraction links, not a complete executable workflow: execution would also require latent and other sampler inputs.

**Extraction decision:** prefer the execution graph. Follow a saved-image branch through decode to its sampler; resolve that sampler's positive and negative conditioning independently; follow its model chain to the relevant checkpoint loader. Never choose the first text node, first seed, or first checkpoint in JSON iteration order. Preserve LoRA/model-chain details and multiple branch candidates in `params`; mark ambiguity instead of fabricating a single definitive generation record. Custom nodes require an explicit adapter or a partial result. Resolve links with visited-node tracking, maximum depth, and bounded graph size.

`KSampler` uses `seed`; `KSamplerAdvanced` uses `noise_seed`. The source declares seeds up to `0xffffffffffffffff`, larger than JavaScript's exact integer range. Parse JSON without rounding large integer tokens, normalize seeds to decimal strings, and keep them strings in Zod contracts, SQLite, exports, and UI copy actions. Calling ordinary `JSON.parse` and then converting the rounded number to a string is too late. Add a fixture containing `18446744073709551615` as an unquoted JSON integer.

Use `workflow` JSON as preserved provenance and a fallback for explicitly supported node schemas. Widget positions can depend on node type/version; indexing arbitrary `widgets_values` arrays cannot reliably recover prompts and models. If multiple outputs lack a reliable mapping to the saved file, retain candidates and report ambiguity.

Source license: [GPL-3.0](https://github.com/Comfy-Org/ComfyUI/blob/f1072eb0350638a3390ddb6afbcaa8c6b237c6fd/LICENSE). Only metadata-format facts and original fixtures are adopted.

### Minimum metadata test matrix

| Case                                                                                                      | Required behavior                                                                        |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Synthetic SD WebUI PNG with English text                                                                  | Prompt, negative prompt, model, seed, and other parameters appear without manual action. |
| Chinese multiline SD WebUI text in `iTXt`                                                                 | Exact Unicode text survives parsing, database storage, API responses, and export.        |
| Missing negative prompt/model; quoted comma/colon values                                                  | Preserve available values; keep missing values empty; retain unknown fields.             |
| ComfyUI execution graph with reordered IDs and unrelated text/model nodes                                 | Recover values from the selected output path, independent of object order.               |
| Multiple samplers, model adapters, unknown custom node, or workflow-only metadata                         | Return supported partial values and explicit candidates/warnings; preserve raw JSON.     |
| Maximum 64-bit seed                                                                                       | Exact decimal value survives end to end with no rounding.                                |
| `zTXt` / compressed `iTXt`, invalid JSON, CRC failure, truncation, oversized/inflating text, cyclic links | Bounded work, controlled warning, and continued import of otherwise valid images.        |
| No metadata or disabled generator metadata                                                                | Normal asset import with an honest empty generation panel.                               |

There is no established universal Midjourney PNG field schema in the producer sources reviewed here. Recognize only explicit known fields when present, retain provenance, and allow manual editing. Do not infer a model or prompt solely from a filename or claim automatic recovery for metadata that does not exist.

## License and dependency gates

The four reference asset managers and the two generator applications are not Cura runtime dependencies. Closed-source interaction references are not dependency candidates. React Flow and Konva have permitted MIT licenses, but a decision to use a particular release still requires checking that release and its dependency graph.

1. **`ffmpeg-static` conflicts with the policy.** Its [manifest](https://github.com/eugeneware/ffmpeg-static/blob/5d17f62ee62b4d11a5c9416ecba44c20464b7a1f/package.json) declares `GPL-3.0-or-later`. Its [README](https://github.com/eugeneware/ffmpeg-static/blob/5d17f62ee62b4d11a5c9416ecba44c20464b7a1f/README.md) explains that downloaded binaries come from separate platform build providers. The [FFmpeg license page](https://ffmpeg.org/legal.html) states that FFmpeg is primarily LGPL, with optional components that make builds GPL. A differently licensed JavaScript wrapper does not change the binary's license. Do not silently add it to satisfy P1; document the browser-decoding alternative and its codec limitations in the architecture/decisions record.
2. **Audit native payloads, not only npm manifest strings.** The mandated [sharp package](https://github.com/lovell/sharp/blob/main/LICENSE) is Apache-2.0, but its underlying [libvips library](https://github.com/libvips/libvips/blob/master/LICENSE) is LGPL-2.1. If the runtime allowlist applies to every bundled native component, the mandated sharp choice and that policy conflict. This research does not claim an exemption or resolve that conflict by relabeling libvips. Track the interpretation and required notices explicitly before distribution; do not report an all-permissive native runtime audit as passed.
3. Check exact versions, bundled artifacts, fonts, and notices before adding each new runtime package. Preserve license notices where required. An upstream package's availability on npm, permissive wrapper license, free download, or GitHub summary alone is insufficient evidence.

## Limits and handoff

Primary documents and source snapshots were retrieved directly; the managed environment's network policy was inspected before access. Immich's documentation website returned HTTP 403, so the exact upstream Markdown sources were read from its repository. No repository code was copied into Cura. Synthetic metadata examples above are original, and no source application was installed to generate them.

This research does not establish OS-specific decoder coverage, browser frame-capture behavior, watcher reliability, or 1,000-image throughput. Those require Cura integration tests and the macOS/Windows smoke runs. Subsequent PRD, architecture, decisions, and task documents should convert the recommendations into concrete contracts and acceptance checks; they must not describe research as already implemented functionality.
