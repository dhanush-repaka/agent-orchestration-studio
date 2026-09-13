# AI Agent Orchestration Studio

Visual studio for quality-engineering agent workflows. Design a graph of agents and tools, run it against a live work item and application URL, then publish results back to Azure DevOps.

Hosted UI: [https://qefoundry.com](https://qefoundry.com)

The sample workflow turns an Azure DevOps user story into generated test cases, a Playwright suite, an execution report, and optional ADO work items.

## What it does

1. Sign in with Supabase Auth.
2. Open the **User Story to Automated Test** workflow.
3. Provide a work item id and a target `baseUrl`.
4. The studio retrieves the work item, asks language-model agents to analyze it and emit test cases, then executes those cases in Chromium.
5. A report is built from the real Playwright totals. If you approve, attachments and (when needed) test cases are published to Azure DevOps.

Agents are generic. They do not pin a fixed Parabank catalog. The Test Case Generator keeps whatever count and titles the model returns. Execute rebuilds one Playwright test per generated case using live page behavior, not invented assertion strings from the model.

## Architecture

| Layer | Role |
| --- | --- |
| Vite + React + Tailwind | Studio UI, React Flow canvas, Zustand store |
| `src/lib/engine.ts` | Runs the graph in the browser. The Run button always uses this local engine. |
| Supabase Auth + tables | Users, workflows, agents, credentials, run history |
| Supabase Edge Functions | LLM calls (`agent-processor`), ADO retrieve/upload, scheduled/webhook triggers |
| Vite middleware (`/__studio/*`) | Local Playwright execute/locator discovery and local ADO helpers |
| Netlify Functions | Hosted Playwright (26s cap) and hosted ADO upload |

Playwright MCP is a node type name only. Execute and locator discovery go through `playwright-execute` and `playwright-locators`, not an MCP server.

## Prerequisites

- Node.js 20 or newer
- npm
- Chromium for Playwright (`npm run playwright:install`)
- A Supabase project (Auth + the studio tables/functions)
- An Azure DevOps PAT if you want live retrieve/upload
- An LLM API key for agent nodes (`LLM_API_KEY`)

## Setup

```bash
git clone https://github.com/dhanush-repaka/agent-orchestration-studio.git
cd "agent orchestration studio"
npm install
npm run playwright:install
```

Create a `.env` file in the repo root (never commit it):

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Optional local ADO overrides (used by Vite middleware):

```bash
ADO_ORG=aiqenexus
ADO_PAT=YOUR_PAT
```

Supabase Edge Function secrets (set in the Supabase dashboard, not in Vite):

| Secret | Purpose |
| --- | --- |
| `LLM_API_KEY` | Required for Requirement Analysis, Test Case Generator, codegen, review, and other LLM agents |
| `LLM_BASE_URL` | OpenAI-compatible base URL. Defaults to `https://api.openai.com/v1` |
| `LLM_MODEL` | Optional model override |
| `ADO_ORG` | Azure DevOps organization. Sample default is `aiqenexus` |
| `ADO_PAT` | Fallback PAT if the Credentials page row is empty |
| `ADO_API_VERSION` | Defaults to `7.0` |
| `SUPABASE_URL` | Injected by Supabase for functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Injected by Supabase for functions |

Start the studio:

```bash
npm run dev
```

Vite prints a local URL (often `http://127.0.0.1:5173`). If that port is busy, use another:

```bash
PLAYWRIGHT_BROWSERS_PATH=0 PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL=0 npm run dev -- --host 127.0.0.1 --port 5176
```

Open that URL, then sign in.

## Login

The login page uses Supabase Auth.

1. Create an account (email + password), or sign in if you already have one.
2. If email confirmation is enabled in Supabase, confirm the email before the first sign-in.
3. After sign-in the workspace (dashboard, workflows, agents, credentials) loads from Supabase.

Session is stored under the `aos-auth` key. Signing out clears it.

## Azure DevOps credentials

Live retrieve/upload needs a PAT with **Work Items** and **Code (Read & Write)**.

Add it in one of these places (first match wins):

1. Browser `localStorage` key `aos-ado-pat` (used by local Vite `/__studio/ado-*` calls)
2. Credentials page row named **Azure DevOps PAT** (read by Edge Functions)
3. Secret `ADO_PAT`

Also set organization/project on the ADO nodes, or use the sample defaults:

- Organization: `aiqenexus`
- Project: `AI_Agents`

A typical sample work item is id `21` (Parabank Registration). Any other work item works. The agents follow that item's title and acceptance criteria.

If the PAT is expired, retrieve falls back to the workflow input and upload records the 401 in the node output. The rest of the run continues.

## Running a workflow

1. Open **Workflows** and select **User Story to Automated Test Workflow**.
2. Confirm the runtime input, for example:

```json
{
  "workItemId": 21,
  "baseUrl": "https://parabank.parasoft.com/parabank"
}
```

`baseUrl` from this input wins over any URL hardcoded on a Playwright node.

3. Click **Run**.
4. Watch node status in the canvas and the live run panel.
5. Approve the publish step if you want the report attached in Azure DevOps.

The Run button always executes in the browser engine (`runLocal`). It does not send the graph through the hosted `execute-workflow` function.

## Sample graph

`n1` start → `n2` ADO retrieve → `n3` requirements → `n5` test cases → `n16` ADO upload → `n6` test data → `n7` Playwright codegen → `n8` locators → `n9` review → `n9c` condition `{{nodes.n9.reviewOk}}`

- Review OK true → `n10` execute
- Review OK false → `n19` code change → `n10` execute

Then `n10` → `n11` defects → `n11c` condition `{{nodes.n10.passed}}`

- Tests passed true → `n12` report → `n13` approval → `n14` Publish to ADO → `n15` end
- Tests passed false → `n17` healing → `n18` re-run → `n12`

`n16` creates test cases. `n14` attaches the report (and repo files when present). If cases were already uploaded, `n14` does not create them again.

## How the agents stay generic

| Agent / node | Behavior |
| --- | --- |
| Data Retrieval | Fetches the work item. On ADO failure, uses workflow input (`Work item {id}`) instead of a canned story. |
| Requirement Analysis | Grounded on the retrieved work item. Ignores upload 401 JSON. |
| Test Case Generator | Sends the work item to the LLM and keeps the returned count and titles. |
| ADO Upload | Creates those cases in ADO. Expired PAT is recorded, not retried forever. |
| Test Data Generator | Uses the generated cases only. |
| Playwright Code Generator | Asked to emit one `test()` per case. That spec is a hint, not the final executable. |
| Locator Discovery | Scrapes the live DOM for `[name=...]` fields and buttons. It skips 404 pages and invented spec strings. Extensionless `/register` is rewritten to `register.htm`. |
| Code Review | Scores the spec 0-10. A score below 7, or three or more issues, is a bad review. |
| Code Change | Runs only when Review OK? is false (score below 7, or 3+ issues). It rewrites the spec from the generated cases and live locators. A good review skips this node. |
| Execute / Re-run | Rebuilds a runnable suite from the generated cases: visible, navigate, required, submit, or negative. Unique usernames, Register link vs Register button, and assertions that exist on real pages. |
| Healing | If the runner never started (config import, timeout, missing Chromium), the generated spec is kept. If tests ran and failed, healing rebuilds the same case-driven suite. |
| Report Generator | Uses execute totals. It does not invent a 10-test report when 8 tests ran. |

## Playwright runner

Local (`npm run dev`):

- Vite middleware at `/__studio/playwright-execute` and `/__studio/playwright-locators`
- Writes `playwright.config.mjs` + `generated.spec.mjs` under `.aos-runs/`
- Runs Chromium with `cwd` set to that folder (avoids the `playwright.config.ts` dynamic-import crash)
- Per-test timeout 15s, retries 0
- Failure screenshots and Playwright traces (`retain-on-failure`). The official HTML report is kept at `.aos-runs/pw-*/playwright-report/` and opened from Run Details
- Unsets `FORCE_COLOR` and sets `NO_COLOR` so ANSI warnings are not treated as the failure

Hosted (`qefoundry.com`):

- Netlify functions with a **26 second** timeout
- Uses `@sparticuz/chromium` and an in-process runner (no Playwright CLI zip)
- A full multi-test suite often cannot finish on the hosted function. Remaining tests are skipped. Run locally for the full suite.

Install browsers once:

```bash
npm run playwright:install
```

## Local vs hosted

| | Local `npm run dev` | qefoundry.com |
| --- | --- | --- |
| UI | Vite on 5173/5176 | Netlify |
| LLM agents | Supabase `agent-processor` | Same |
| ADO retrieve/upload | `/__studio/ado-*` first, then Edge Functions | Edge Functions + Netlify upload |
| Playwright | Local Chromium, minutes allowed | 26s function cap |
| Studio Run button | Browser engine in both places | Same |

If hosted execute returns `source: "unavailable"` or a 26s timeout, open the same workflow on a local Vite server.

## Scripts

```bash
npm run dev          # studio + local Playwright/ADO middleware
npm run build        # production UI
npm run preview      # serve the production build
npm test             # Vitest
npm run typecheck    # tsc
npm run lint         # ESLint
npm run playwright:install
```

## Troubleshooting

**Playwright: `Failed to fetch dynamically imported module .../playwright.config.ts`**
The runner must write `.mjs` config and start Playwright with `--config=playwright.config.mjs` from the run directory. Restart `npm run dev` after pulling runner changes.

**UI shows only `NO_COLOR` / `FORCE_COLOR` and 0 tests**
Those lines are Node warnings, not the failure. The runner now parses the list reporter when `results.json` is missing. If you still see 0 tests, the process was killed (timeout) before any test finished.

**11 tests ran and most failed with 15s timeouts**
The model asserted copy that is not on the page (`Welcome John Doe`, `Email field is required`) or clicked ambiguous `text=Register` (home has a link; the form has a button). Execute now rebuilds from the cases. Re-run on local Vite.

**Locator discovery HTTP 400**
The spec used `` page.goto(`${baseUrl}/register.htm`) `` as a literal URL. Template paths are skipped. Discovery uses `/` plus real `page.goto` paths.

**ADO 401 / TF401349 / PAT expired**
Create a new PAT with Work Items and Code (Read & Write). Save it on the Credentials page as **Azure DevOps PAT**, or set `aos-ado-pat` / `ADO_PAT`. Upload will record the error and the graph continues.

**Hosted execute stops around 26s**
Expected. Use `npm run dev` for the full suite.

**Chromium missing**
Run `npm run playwright:install`. On Apple Silicon set `PLAYWRIGHT_BROWSERS_PATH=0` and `PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL=0` when starting Vite.

**Agents invent a different product**
Requirement and test-case prompts are grounded on the retrieved work item. If retrieve failed, they use the workflow input only. They should not use a canned Parabank story unless that is the work item.

**Publish created duplicate test cases**
`n14` skips create when an earlier upload already returned `results[].success`. If you still see duplicates, check that `n16` completed before `n14`.

## Tests

```bash
npm test
```

Coverage includes interpolation, the workflow engine, Playwright spec helpers, and ADO artifact collection. Playwright unit tests do not hit Parabank. Use a local Run (or POST `/__studio/playwright-execute`) to verify Chromium against a live `baseUrl`.

## Deploy

- **UI:** Netlify build `npm run build`, publish `dist`. Redirects in `netlify.toml` send `/__studio/playwright-*` and `/__studio/ado-upload` to functions.
- **Functions:** `netlify/functions/playwright-execute.ts`, `playwright-locators.ts`, `ado-upload.ts`, `health.ts`.
- **Supabase:** deploy Edge Functions (`agent-processor`, `ado-retrieval`, `ado-upload`, and the others under `supabase/functions/`). Keep `_shared/engine.ts` and `_shared/playwrightSpec.ts` in sync with `src/lib`.

qefoundry.com currently publishes the Vite UI (Bolt / static Netlify). A Bolt publish does not include `netlify/functions`, so `/__studio/playwright-execute` returns HTML and Execute reports `source: unavailable`. To run Chromium on the hosted site:

1. In the qefoundry.com Netlify site, link this GitHub repo and set Functions directory to `netlify/functions`, or
2. Add GitHub secrets `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` so `.github/workflows/deploy-netlify.yml` can `netlify deploy --prod --dir=dist --functions=netlify/functions`.

After a functions deploy, `GET /.netlify/functions/health` should return `{"ok":true,"service":"aos-functions"}` instead of `index.html`.

Do not commit `.env`, `.ado-pat`, or any PAT.
