# Dependency and native-runtime notices

Cura's own source is [MIT licensed](../LICENSE). Dependencies retain their upstream licenses. Exact JavaScript package versions are pinned in the workspace manifests and `pnpm-lock.yaml`; installed platform-native artifacts have their own manifests and notices.

## Direct runtime packages

| Packages                                                                          | License    | Role                                                                                                                |
| --------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Fastify, `@fastify/static`, `@fastify/websocket`, Pino                            | MIT        | Local HTTP/WebSocket server, static assets, logging                                                                 |
| better-sqlite3                                                                    | MIT        | SQLite bindings and published native addon; SQLite itself is [public domain](https://www.sqlite.org/copyright.html) |
| Drizzle ORM                                                                       | Apache-2.0 | Database schema/migration integration                                                                               |
| Sharp                                                                             | Apache-2.0 | Native image processing wrapper; this license does **not** cover every bundled native library                       |
| chokidar, exifr, fflate, env-paths, open                                          | MIT        | Watching, EXIF parsing, ZIP output, OS directories, browser launch                                                  |
| React, React DOM, i18next, react-i18next, Zustand, `@tanstack/react-virtual`, zod | MIT        | UI, translations, state, virtualization, shared contracts                                                           |

Development tools such as TypeScript, Vite, ESLint, Vitest, and Playwright are separately pinned. No GPL/AGPL application source is copied into Cura. `ffmpeg-static` is **not installed or bundled**; P1 media support must reconcile format coverage with the dependency constraints before release.

## Sharp and bundled libvips

The required Sharp stack is an explicit native-runtime exception recorded in [DECISIONS.md](DECISIONS.md#png-text-and-native-library-interpretation), not a claim that all runtime code is permissively licensed.

The inspected Linux x64 installation contains:

| Artifact                                                                                                             | Version / declared license                             |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`sharp`](https://github.com/lovell/sharp) npm package                                                               | `0.34.4`, Apache-2.0                                   |
| Upstream [libvips](https://github.com/libvips/libvips)                                                               | `8.17.2`, LGPL-2.1-or-later                            |
| [`@img/sharp-libvips-linux-x64`](https://www.npmjs.com/package/@img/sharp-libvips-linux-x64/v/1.2.3) prebuilt bundle | `1.2.3`, **LGPL-3.0-or-later** in its package manifest |

The native bundle's README explicitly uses LGPLv3 for several libraries through the “any later version” clause of LGPLv2/LGPLv2.1. Its bundled runtime must therefore not be described simply as Sharp's Apache-2.0 package or solely as upstream libvips LGPL-2.1. It also includes MPL-2.0 and other license terms.

The following reproduces the license assignments in that bundle's upstream notice, grouped for readability:

| Native libraries                                                        | Terms named by the bundle                                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| fribidi, glib, libexif, libheif, librsvg, libvips, pango, proxy-libintl | [LGPLv3](https://www.gnu.org/licenses/lgpl-3.0.html), via the later-version option where applicable         |
| cairo                                                                   | [Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/)                                        |
| cgif, expat, harfbuzz, lcms, libffi, libnsgif, libxml2, pixman          | MIT                                                                                                         |
| aom                                                                     | BSD 2-Clause plus [Alliance for Open Media Patent License 1.0](https://aomedia.org/license/patent-license/) |
| highway                                                                 | Apache-2.0 and BSD 3-Clause                                                                                 |
| libarchive                                                              | BSD 2-Clause                                                                                                |
| libimagequant                                                           | [BSD 2-Clause](https://github.com/lovell/libimagequant/blob/main/COPYRIGHT)                                 |
| libwebp                                                                 | New BSD                                                                                                     |
| fontconfig                                                              | [fontconfig license](https://gitlab.freedesktop.org/fontconfig/fontconfig/blob/main/COPYING), BSD-like      |
| freetype                                                                | [FreeType license](https://git.savannah.gnu.org/cgit/freetype/freetype2.git/tree/docs/FTL.TXT), BSD-like    |
| libpng                                                                  | [libpng license](https://github.com/pnggroup/libpng/blob/master/LICENSE)                                    |
| libspng                                                                 | [BSD 2-Clause and libpng license](https://github.com/randy408/libspng/blob/master/LICENSE)                  |
| libtiff                                                                 | [libtiff license](https://gitlab.com/libtiff/libtiff/blob/master/LICENSE.md), BSD-like                      |
| mozjpeg                                                                 | [zlib, IJG, and BSD-3-Clause terms](https://github.com/mozilla/mozjpeg/blob/master/LICENSE.md)              |
| zlib-ng                                                                 | [zlib license](https://github.com/zlib-ng/zlib-ng/blob/develop/LICENSE.md)                                  |

The installed platform package includes `README.md` for the native notices and `versions.json` for the exact bundled-library versions. On pnpm, find these under `node_modules/.pnpm/@img+sharp-libvips-<platform>@<version>/node_modules/@img/sharp-libvips-<platform>/`. The [sharp-libvips project](https://github.com/lovell/sharp-libvips) supplies the build sources/recipes and upstream library references. These notices identify what was inspected; platform-specific bundles may differ and require their own manifest/README review.

Preserve upstream license, copyright, and source-availability notices when redistributing native artifacts. This file is a dependency record, not a replacement for their full license texts or a legal determination. The exception covers the mandated native stack; it does not authorize unrelated GPL/AGPL dependencies.

## Installation and updates

Cura selects published better-sqlite3 and Sharp platform binaries and verifies them during `pnpm install`. The SQLite check executes a native query; the Sharp check encodes/decodes an image. Installation must fail clearly rather than compiling with node-gyp when a supported prebuilt is unavailable.

When updating dependencies, review direct/transitive npm licenses **and** bundled-native manifests/notices. Keep the lockfile, this notice, and DECISIONS aligned; verify native smoke checks on the supported OS/architectures. Linux evidence alone does not establish macOS/Windows native compatibility.
