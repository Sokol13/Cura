# Phase 0 desktop smoke test

This checklist covers v0.0.1 scaffolding only. Asset libraries and other business features are deliberately absent.

1. Follow SETUP.md to install Node 22, pnpm 10.34.6 and Git on macOS or Windows. Clone into a new directory.
2. Run `pnpm install --frozen-lockfile`. Confirm SQLite reports a verified prebuilt binary and never invokes a compiler.
3. Run `pnpm build && pnpm start`. Confirm the default browser opens the Cura placeholder page and the process remains alive. The title is Cura and the default copy is Chinese.
4. Request `http://127.0.0.1:3000/api/health`; expect HTTP 200 and `{"status":"ok"}`. The service must not bind to a public interface.
5. Check the operating-system paths listed in SETUP.md for `cura.sqlite`, its WAL-related files while running, and `cura.log`. Confirm no runtime database/cache/log files appeared in the checkout.
6. Stop the service with Ctrl+C, start it again and repeat the health check. Existing metadata must survive migration/startup.
7. Run `pnpm dev`. Open the Vite URL printed in the terminal. Confirm `/api/health` works through the proxy and changing placeholder copy triggers a browser update. Restore the edit and stop the processes.
8. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`. Review the screenshot in `docs/screenshots/phase-0.png`.

If something fails, record the operating system, Node/pnpm versions, command, terminal error and relevant `cura.log` lines. Do not include tokens or other credentials. Windows checkouts force LF text endings through .gitattributes so Git Bash can run the setup script.
