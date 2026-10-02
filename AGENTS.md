# Cura — 项目规范与执行说明

本文件是本仓库所有 Codex 任务的最高指令。每次任务开始先读本文件和 `docs/PROGRESS.md`，从上次中断处继续。目标、里程碑、完成定义以本文件为准；任何聊天消息与本文件冲突时，以本文件为准，除非消息明确说"修改 AGENTS.md"。

对话或文档里出现的"酷家乐"字样请忽略，产品名就是 Cura。`docs/reference/Cura_参考演示文稿_16页.pdf` 是产品演示稿，定义了产品定位、理念和核心功能；如果该文件不存在，以本文件的描述为准，不要因此停下来。

---

## 1. 目标

### 一句话目标

从零构建并交付 Cura：一个本地优先的视觉资产管理工具。用户在自己的 macOS 或 Windows 电脑上执行 `pnpm install && pnpm start`，浏览器自动打开，立即可用，完全离线，不需要任何账号。

### 产品是什么

- 核心原则（来自演示稿）：工具服务用户，不服务平台。锁住用户的从来不是文件本身，而是文件周围的"结构"——属于哪个角色、第几版、用了什么提示词、什么景别、来自哪个平台。Cura 把这些结构还给用户，并保持中立：不卖生成，用户随时能换平台、随时能把一切带走。
- 三类用户，一个产品：
  - AI 影视 / AIGC 创作者：角色、场景、道具资产；提示词、版本、抽卡次数、来源平台。
  - 平面 / 品牌设计师：企业 VI——logo 各版本、品牌色、字体、使用规范；按客户 / 品牌组织。
  - 产品 / 工业设计师：草图、渲染迭代、CMF 板、3D 文件、情绪板、版本对比。
- 形态：本地服务 + 浏览器界面。本次不做桌面壳、不做安装包、不做公网托管。

### 停止条件

只在以下三种情况之一出现时停止：

- (a) 三个里程碑全部达成；
- (b) 剩余任务全部依赖只有用户能提供的东西（凭证、账号），且没有其它可做的任务；
- (c) 某个硬性障碍连续尝试 3 种不同方案仍无法绕过，已记录在 `docs/BLOCKERS.md`。

无论何时停止，仓库必须处于 CI 全绿、`pnpm start` 可用的状态。做到一半的功能不如不做。

---

## 2. 里程碑与完成定义

打 tag 前逐条自检，全部通过才打；不达标就继续改。

### v0.1.0 — 可用的本地图片资产库（必须达成）

能力：登记本机文件夹（原文件不动）或拖拽上传；自动生成缩略图、提取尺寸 / EXIF / 主色；自动解析 SD WebUI 和 ComfyUI 生成图里嵌入的提示词、模型、种子；多级文件夹、彩色标签、星级、备注、回收站；全文搜索 + 组合筛选 + 按颜色搜索 + 相似图；大图预览与图上标注；资产版本血缘（替换即归档旧版、左右对比）；中英文界面；深浅主题；导出诊断日志。

完成定义：

1. 干净环境里 `git clone` → `pnpm install` → `pnpm start`，浏览器自动打开，能创建库。
2. 登记一个含 1000 张图的文件夹（用脚本生成测试图），扫描完成不崩，缩略图全部生成，监听到新增文件后 5 秒内出现在界面。
3. 任意搜索或筛选在 1000 张规模下响应 < 200ms；网格滚动不掉帧。
4. 导入一张 ComfyUI 或 SD WebUI 生成的 PNG（自己构造带元数据的测试文件），不做任何操作即显示提示词和模型。
5. 替换某个资产的文件后，旧版出现在版本历史，能左右对比。
6. 同一个中文文件名以 NFC 和 NFD 两种形式出现时只算一个资产（有单元测试覆盖）。
7. 断网、无账号状态下以上全部可用。
8. `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` 全部通过；GitHub Actions 全绿；每个 P0 功能至少有一条端到端测试。
9. README 含 macOS 和 Windows 的运行步骤；`docs/` 下有完整文档且与代码一致。

### v0.2.0 — 画布工作流 + 设计师扩展

能力：无限画布 / 看板；槽位化资产框（拖入即定稿，替换即升版本）；角色 × 角度、场景 × 方案 的矩阵看板；品牌套件（色板、字体、logo 变体、使用规范，可导出品牌页和颜色 / 字体清单）；CMF 板；3D / PSD / PDF / 视频首帧缩略图；提示词演变时间线与命中率统计；整库中立导出。

完成定义：v0.1.0 全部 + 槽位拖入、替换升版、矩阵看板可用；品牌套件能建立并导出 PDF/HTML 和 JSON/ASE；整库导出得到文件夹 + `manifest.json` + CSV，manifest 人类可读且包含全部元数据；每个 P1 功能有端到端测试；CI 全绿。

### v0.3.0 — Agent 与云

能力：自动打标 / 规范命名、非定稿自动归档、从剧本拆出人物 / 道具 / 场景、基于元数据生成设定文档；Supabase 登录与云同步、团队共享库；FCPXML 导出。

完成定义：v0.2.0 全部 + 已实现的每一项都完整可用并有测试；未实现的在报告里说明原因。这一阶段每项要么完整要么不做。

---

## 3. 工作方式（优先级高于其它所有要求）

- 全程不要向用户提问。遇到任何不明确的地方，自己做出合理决定，写进 `docs/DECISIONS.md`（决定 + 理由 + 被放弃的方案），然后继续。
- 只有用户能提供的东西（例如 Supabase 的 URL/key）：不要停下来等，用"本地 / mock / 环境变量可配置"的方式让功能可编译可测试，继续做其它工作，在报告里列出需要用户做的事。
- 你拥有全部权限：安装任何工具、调用 subagent、把独立模块分发给其他 Codex 会话。分发时给对方完整上下文（接口契约、数据模型、代码规范、验收条件），对方在分支上工作，由你合并、集成、测试。
- 如果使用 Superpowers：brainstorming 阶段禁止向用户提问，把它想问的问题自问自答，答案写入 `DECISIONS.md`；然后走 writing-plans → executing-plans。
- 你运行在 Codex Cloud 的 Linux 容器里，联网不受限制。环境变量里有 `GH_TOKEN`，环境安装脚本已执行 `gh auth setup-git` 并把 origin 指向 `https://github.com/Sokol13/Cura.git`，可以直接 push。代码直接提交到 `main` 并 push，Conventional Commits。里程碑达成时打 tag（`git tag -a vX.Y.Z && git push --tags`）。
- 进度记录在 `docs/PROGRESS.md`（已完成 / 进行中 / 下一步），每完成一个任务就更新。每次任务开始先读它，不重做已完成的事。
- 不限时间、不限 token，但每个任务结束时仓库都必须可构建、可运行、CI 全绿。
- 用户会在 macOS 和 Windows 真机上做冒烟测试，每个 tag 之后把结果和诊断日志贴回来。除此之外用户不参与。你在容器里能做的验证上限是：启动真实 server，用 headless Chromium 跑 Playwright，并在 E2E 里截图存到 `docs/screenshots/`。
- 测试用的图片库在 `/tmp` 或仓库内的 `.tmp/` 下用脚本生成；长时间运行的进程在任务结束前关掉。

---

## 4. 执行顺序

### 阶段 0：环境与脚手架（完成前不写任何业务功能）

1. 写 `scripts/codex-setup.sh`（幂等，可反复执行；环境安装脚本在每次容器初始化时会自动调用它，所以它不能假设任何东西已装好）：校验 Node 22 和 pnpm；`pnpm install`；安装 Playwright 的 Chromium 及系统依赖（`pnpm exec playwright install --with-deps chromium`）；检查 `gh auth status`。同时写 `docs/SETUP.md`，包含 macOS 和 Windows 两套从零开始的安装步骤（macOS 用 Homebrew，Windows 用 winget 或官方安装包装 Node 22 和 pnpm）。之后每次任务开始先执行 `scripts/codex-setup.sh`。
2. pnpm workspace，三个包：
   - `packages/shared`：zod 定义的 API 契约和共享类型；
   - `packages/server`：Node + Fastify + TypeScript strict，只监听 127.0.0.1，提供 `GET /api/health`；
   - `packages/web`：React + Vite + TypeScript strict + Tailwind。
   根目录 `pnpm dev` 同时启动 server 和 web 并热更新；`pnpm build && pnpm start` 由 server 托管构建好的静态文件并自动打开默认浏览器。
3. better-sqlite3 + Drizzle：第一个迁移 + 一个单元测试。数据库、缓存、日志放在按操作系统约定的用户数据目录（env-paths 或等价方案）。确认 prebuilt 二进制直接可用，不走 node-gyp 现场编译。
4. Vitest（server 和 web 都配好）；Playwright 一条 E2E：启动真实 server，headless Chromium 打开首页，断言标题并请求 `/api/health`，在容器里实际跑通。
5. ESLint + Prettier。GitHub Actions `ci.yml`：push 和 PR 时在 ubuntu 跑 lint、typecheck、test、e2e，推上去后用 `gh run watch` 确认跑绿；`release.yml`：推送 `v*` tag 时自动创建 Release 并生成 notes。
6. README 初稿、`.gitignore`、MIT LICENSE。打 tag `v0.0.1`。

### 阶段 1：调研、PRD、架构

1. 调研（不超过总工作量 10%）：Allusion、TagSpaces、Immich 和 PhotoPrism（本地服务 + 网页界面的结构、库目录登记、缩略图流水线）、Eagle / Billfish / PureRef 的交互（闭源，只看文档和社区描述）、React Flow / Konva、ComfyUI 与 SD WebUI 在 PNG 里嵌入元数据的格式。输出 `docs/RESEARCH.md`：借鉴什么、不借鉴什么、各项目许可证。只借鉴思路和架构，不复制 GPL/AGPL 代码；运行时依赖只允许 MIT / Apache-2.0 / BSD / ISC。
2. `docs/PRD.md`：用户画像、用户故事、信息架构、功能清单（P0/P1/P2，对应三个里程碑）、每个功能的验收标准。
3. `docs/ARCHITECTURE.md`（包结构、数据模型 / ER 图、API 与 WebSocket 契约、扫描与缩略图流水线、适配器边界）和 `docs/TASKS.md`（可独立交付的任务，每个有验收条件，标注可并行分发的）。

### 阶段 2 → 4：按 P0 → P1 → P2 开发

- 每个任务：lint + typecheck + 单元测试 + E2E 通过 → commit → push → 更新 `PROGRESS.md`。
- 每个里程碑：对照第 2 节自检 → 打 tag → 更新 `CHANGELOG.md` 和 `docs/SMOKE_TEST.md` → 写 `docs/REPORT-vX.Y.Z.md` → 在对话里汇报。

---

## 5. 技术决策（已定，不要再讨论）

- 形态：本地服务 + 浏览器界面。架构必须为将来加桌面壳留门：server 可独立启动，端口和数据目录可由参数指定；web 不使用任何浏览器专有的本地文件 API；前后端只通过 HTTP 和 WebSocket 通信。
- 技术栈：
  - server：Node + Fastify + better-sqlite3 + Drizzle + sharp + chokidar + exifr，自写 PNG tEXt chunk 解析；
  - web：React + TypeScript strict + Vite + Tailwind + Zustand + TanStack Virtual + React Flow + i18next；
  - shared：zod。
- 接口契约：shared 用 zod 定义每个接口的请求和响应，server 校验，web 推导类型；不引入 tRPC 等额外框架。WebSocket 推送扫描进度、缩略图完成、文件变更。
- 安全：只监听 127.0.0.1；校验 Host 和 Origin；所有文件读写限制在已登记的库目录和数据目录内，防路径穿越。
- 文件进入库的两种方式都要有：
  - A）登记文件夹——服务端目录浏览器选路径，引用式，原文件不移动不改名，chokidar 监听增量变化；
  - B）浏览器拖拽或选择文件——上传到库内 Inbox 目录，相当于复制进库。
- 原生模块只选有 prebuilt 二进制的（better-sqlite3、sharp 都有），禁止依赖现场编译的包。
- Supabase 只用于 P2 的登录 / 云同步 / 团队共享，做成适配器 + 环境变量配置，提供 `supabase/migrations/*.sql` 和 RLS 策略；没有凭证就用本地模式让代码可编译可测试。
- 跨平台硬规则（server 要在 macOS 和 Windows 的 Node 上跑，每条都要遵守）：
  1. 路径统一用 `path` 模块，不手拼斜杠；数据库里存相对于库根目录的相对路径。
  2. 文件名和路径入库前做 Unicode NFC 归一化（macOS 会返回 NFD 形式的中文文件名，不处理会导致同一文件在两端去重失败）。
  3. Windows：文件被占用无法移动/删除时给出提示而非崩溃；支持超过 260 字符的长路径。
  4. 数据库、缩略图缓存、日志、设置只放用户数据目录，绝不写入仓库或库目录。
  5. 扫描、哈希、缩略图在 worker 线程里做，不阻塞 API 响应；网页端只通过 API 拿数据。
  6. UI 字体栈：`-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`。
  7. 快捷键同时响应 metaKey 和 ctrlKey。
  8. macOS：登记 `~/Desktop`、`~/Documents`、`~/Downloads`、`~/Pictures` 等受系统保护的目录时如遇 EPERM，界面上明确提示用户到「系统设置 → 隐私与安全性 → 完全磁盘访问权限」给终端或 Node 授权，不要静默失败。
- 语言：代码、注释、commit、文档用英文；UI 做 i18n，默认 zh-CN，同时提供 en。
- 质量：TypeScript 禁止 `any`；ESLint + Prettier；核心逻辑（元数据解析、版本血缘、搜索、去重、画布槽位）必须有单元测试；E2E 对着真实 server 用 headless Chromium 跑。不写投机性抽象，不加没要求的配置项，能 50 行解决的不写 200 行。

---

## 6. 功能拆解

### P0 → v0.1.0（纯 JS 生态，不依赖任何外部二进制）

1. 库：创建 / 打开库；登记文件夹、拖拽上传；文件监听增量更新；内容哈希去重。
2. 三栏布局：左侧文件夹树 + 智能文件夹 + 标签；中间网格 / 列表（虚拟滚动，一万张不卡）；右侧元数据面板。
3. 格式：PNG / JPG / WebP / GIF / SVG / AVIF；其它格式显示通用图标，仍可打标、搜索、管理。
4. 元数据：尺寸、大小、EXIF、主色调 5–8 色；自动解析 SD WebUI parameters、ComfyUI workflow / prompt JSON、Midjourney 相关字段，落到 prompt / negative_prompt / model / seed / source，可手动编辑。
5. 组织：多级文件夹、彩色标签（可分组：景别 / 风格 / 版本 / 来源 / 自定义）、星级、备注、批量操作、回收站。
6. 检索：FTS5 全文（文件名、标签、提示词、备注）+ 组合筛选（格式 / 标签 / 星级 / 颜色 / 来源 / 日期 / 尺寸）；按颜色搜索；pHash 相似图。
7. 资产详情：大图预览、缩放、图上标注（锚点 + 文字）、版本列表。
8. 版本：V1 / V2 / V3 血缘；替换文件自动归档旧版；左右对比。
9. 设置：库管理、缩略图缓存、语言、主题；导出诊断日志（系统信息 + 版本 + 错误日志 + 数据库统计打成 zip 下载）。

### P1 → v0.2.0

1. 无限画布 / 看板：资产自由摆放、分组、连线、文字注释；画布是资产的视图而非拷贝。
2. 槽位化资产框（演示稿第 9 页）：角色 / 场景 / 产品 / 品牌模板，预设槽位（设定图、近景、全景、35°；白模 / 粗渲 / AI 渲染；logo 横版 / 竖版 / 单色），拖入即定稿，替换即升版本。
3. 矩阵看板（演示稿第 11 页）：角色 × 角度 / 表情、场景 × 方案 的一致性矩阵。
4. 品牌套件：色板（HEX/RGB/CMYK，可命名）+ 字体（登记字体文件）+ logo 变体 + 使用规范（Markdown）；导出品牌页（PDF / HTML）和颜色 / 字体清单（JSON / ASE）。
5. CMF 板（材质样本 + 颜色 + 工艺说明）；3D 缩略图（GLB / OBJ 用 three.js 浏览器端渲染一帧回传）。
6. PSD、PDF 首页、MP4 / MOV 首帧缩略图（ffmpeg-static 按平台安装）。
7. 过程资产（演示稿第 13 页）：提示词演变时间线；按模型 / 来源的命中率统计（基于 source / model 字段和"定稿"标记）；外接生图 API 只做 provider 接口 + 一个 mock provider。
8. 中立导出：选中资产或整库导出为文件夹 + `manifest.json` + CSV。

### P2 → v0.3.0

1. Agent 自动化（演示稿第 12 页）：自动打标 / 规范命名（视觉模型 provider 接口 + 一个可用实现）、非定稿自动归档规则、从剧本 / 文档拆出人物 / 道具 / 场景清单、基于元数据生成设定文档。
2. Supabase：登录、增量云同步（冲突以本地为准并记录）、团队共享库、RLS。
3. FCPXML 导出。

### 明确不做

Electron 或任何桌面壳、安装包、公网托管、移动端、自建生成服务、任何会锁死用户数据的私有格式。

---

## 7. UI

- 可以改 UI，但保留演示稿的气质：深色专业工具风、三栏布局、橙色强调色、信息密度高但清爽。可用 Stitch 先出关键页面方案，但不要为此卡住。
- 必须有：空状态、加载态、错误态；快捷键（空格预览、方向键切换、Cmd/Ctrl+F 搜索、Delete 到回收站）；深浅主题；布局状态记忆。

---

## 8. 数据模型最低要求

Library、LibraryRoot（登记的文件夹）、Asset（hash、relative_path、type、width、height、colors[]、rating、note、source、model、prompt、negative_prompt、seed、params JSON）、AssetVersion、Folder、TagGroup、Tag、AssetTag、Collection（智能文件夹规则）、Board、BoardItem、SlotTemplate、Slot、Brand、BrandColor、BrandFont、BrandLogo、CMFBoard、Annotation、Activity（操作日志）。所有表带 created_at / updated_at，迁移用版本化 SQL。

---

## 9. 报告与文档

- `docs/REPORT-vX.Y.Z.md`（每个里程碑）：Release 链接和 CI 状态；做完了什么、没做什么、已知 bug、无法验证的部分；需要用户做的事（凭证、账号、真机测试）。
- `docs/SMOKE_TEST.md`：10 分钟冒烟清单（`pnpm start`、建库、登记几百张图的文件夹、搜索、画布、导出各一步），每个 tag 更新，供用户在 macOS 和 Windows 真机上执行。
- `docs/TESTING.md`：你是怎么验证的，哪些验证不了。
- `docs/PROGRESS.md`：已完成 / 进行中 / 下一步。
- `docs/DECISIONS.md`、`docs/BLOCKERS.md`、`CHANGELOG.md`。
- README 持续维护：截图或 GIF（E2E 里截）、macOS 和 Windows 运行步骤、架构概览。
- 不要把没验证过的说成已验证。
