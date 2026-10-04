# Creative process and portable export

Open **Creative process** from a library toolbar. The Timeline shows retained versions, prompt/model/source/seed changes, raw generation parameters, and the owners of exact final selections. Selecting a current version adds the asset's manual selection; clearing it leaves slot selections alone. If a file or manual selection changed while the timeline was open, Cura refuses the stale action and refreshes the history before you choose again.

Statistics count distinct recorded outputs across current and historical versions, including trash. Forks sharing an inherited version keep the same generation identity. Multiple manual/slot owners selecting one output count once. The selection rate is selected outputs divided by recorded outputs, with zero for an empty library. Source/model groups trim and fold case; unknown values remain explicit. Legacy identities group library, retained hash and original version creation time, with the lowest version UUID supplying deterministic canonical metadata. They are labeled as reconstructed history; unrecorded generation attempts cannot be inferred.

The **Mock generator** creates deterministic geometric PNG illustrations locally through the real ingestion pipeline. It has no credentials or remote model connection. A documented 1.5-second simulated render stage makes cancellation usable. Successful outputs have exact decimal 64-bit seeds and embedded PNG parameters. Failure simulation is explicit. Cancellation stops remaining work and keeps outputs that were already imported.

## Downloading an archive

The **Export** tab creates a whole-library ZIP or exports the asset selected in Timeline. The exported ZIP opens as a folder in ordinary archive tools. It contains:

- `manifest.json`: indented UTF-8 `cura-export/1` metadata, original identities/timestamps, all included version metadata and exact seed strings, source aliases and availability, folders, tags and relation timestamps, smart folders, annotations, generation jobs, final owners, boards, slots and immutable slot revisions, templates, brands, CMF entries, and activity.
- `assets.csv`: a spreadsheet-friendly asset summary. Every cell is quoted and embedded quotes/newlines are retained. Formula-like values receive a leading apostrophe. JSON retains the exact original values.
- `files/<sha256>/<portable-name>`: every distinct retained file, including historical versions, trash, unavailable originals, and pinned resources. Equal hashes share a file and list all corresponding version IDs in the manifest.
- `README.txt`: interpretation and selection-dependency rules.

The export reads one consistent private SQLite transaction, without public query pagination. Whole-library exports include removed roots and every asset version. Original reference paths are informative metadata; managed Inbox roots use the label `Inbox`. Private snapshot, cache and archive paths are excluded.

Selected exports preserve complete board and brand structures and all current/historical pinned assets. They also include linked generation-job outputs and similarity references used by saved searches. The explicit `includedDependencyAssetIds` list distinguishes those assets from the requested selection. Library organization remains context for the included assets.

File bytes are streamed in a worker in 256 KiB chunks with backpressure. Archives use ZIP STORE because media is already compressed. Each included file's size and SHA-256 are checked before completion. Missing or changed retained bytes fail the job visibly; a failed archive cannot be downloaded. Jobs survive reload; an interrupted job is marked failed at startup and can be recreated. Two exports may run concurrently. The current portable ZIP writer accepts up to 3.5 GB of file and metadata bytes and 65,532 distinct files per export; larger libraries can be exported as smaller selections.

## API and verification

- `GET /api/libraries/:id/process`, `GET /api/assets/:id/process`
- `PUT /api/assets/:id/process/selection` with `versionId`, `expectedSelectionVersionId` (nullable), and `selected`; stale current-version or manual-owner state returns HTTP 409.
- `GET|POST /api/libraries/:id/generations`, `GET /api/generations/:id`, `POST /api/generations/:id/cancel`
- `GET|POST /api/libraries/:id/exports`; POST accepts `{scope:"library"}` or `{scope:"selection",assetIds:[...]}`.
- `GET /api/exports/:id`, `GET /api/exports/:id/file` (available only after verified completion).

Process tests cover fork identities, deterministic legacy backfill, independent final owners, stale selection rejection, actual mock PNG decoding and real ingestion. Export tests use real SQLite/media/workers and historical replacements, pins, removed roots, trash, exact metadata, quoted CSV and corrupt retained files. Browser acceptance blocks external HTTP/WebSocket requests and exercises the actual controls and downloads. The export browser fixture has 205 assets to exceed public pagination; Python's independent standard-library ZIP, CSV and SHA-256 readers inspect both downloaded archives.
