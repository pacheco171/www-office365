# LAD

## Trace Memory Protocol

This project uses lad-mcp to map IO boundaries. Traces are stored in `.lad/traces/`.

### Exploring the codebase

Traces are the project's architectural memory. Before reading source files
to answer questions or gather context, ALWAYS check traces first:

1. Run `trace_list` to see what is already documented
2. Read `trace://summary` for a lightweight index of all traces and the files they cover
3. If a trace covers the area of interest, read it via `trace://{name}` instead of opening source files
4. Only fall back to reading source files when no trace exists or when you
   need line-level detail beyond what the trace provides

Traces exist to save tokens and speed up responses — treat them as the
primary source of truth for understanding project structure and IO flows.

### Before modifying code

1. Read `trace://summary` to see all documented traces and which files they cover
2. If the file you are about to modify appears in a trace, read the full trace via `trace://{name}`
3. Understand the IO boundaries before making changes

### After modifying code

1. If any IO boundary changed (new DB query, HTTP call, queue dispatch, etc.), run `trace_update` for affected traces
2. If a completely new IO flow was added, use the `trace_scan` prompt to create a new trace

### Quick reference

- `trace_list` — see all traces
- `trace://summary` — lightweight index of all traces and their files
- `trace://{name}` — read a specific trace in full
- `trace_scan` prompt — create new traces
- `trace_update` prompt — update existing traces after code changes
- `trace_diff` prompt — analyze impact of a PR on existing traces
## Standards Protocol

> **MANDATORY:** You MUST use these tools on every code task. They are not optional.

### Step 1 — BEFORE editing (required)

```
std_check_impact({ filePath: "path/to/file" })
```

Run on EVERY file you plan to modify. Check the blast radius, dependents, and affected traces. Do NOT skip this step.

Then consult the relevant specialist for your domain:

| Domain | Prompt to use |
|--------|---------------|
| UI, components, CSS, accessibility | `std_frontend_specialist` |
| APIs, services, error handling | `std_backend_specialist` |
| Mobile UI, offline-first | `std_mobile_developer` |
| Schema, queries, migrations | `std_database_architect` |
| Auth, validation, secrets, OWASP | `std_security_auditor` |
| SEO, meta tags, structured data | `std_seo_specialist` |
| Performance, caching, bundles | `std_performance_optimizer` |
| Tests, coverage, e2e | `std_test_engineer` |
| Lint, types, import cycles, i18n | `std_lint_validator` |

### Step 2 — DURING implementation (apply)

- SRP: each function/class does ONE thing
- DRY: extract duplicates, reuse
- KISS: simplest solution that works
- Functions: max 20 lines, max 3 args, guard clauses over nesting
- Naming: verbs for functions, `is/has/can` for booleans, SCREAMING_SNAKE for constants

For full standards: `std_principles({ context: "all" })`

### Step 3 — AFTER implementation (required)

```
std_review({ filePath: "path/to/changed/file" })
```

Run on EVERY file you changed. Fix violations before marking the task as complete.

Then self-check: goal met? all files edited? code works? no errors? edge cases?

## PM Skills Protocol

Product management skills for structured discovery, planning, and execution.

### Finding the right skill

```
pm_search({ query: "user story" })
pm_search({ type: "component" })
pm_search({ theme: "discovery-research" })
```

Or browse the full catalog: `pm://catalog`

### Using a skill

```
pm_skill({ name: "user-story" })
```

Follow the Application steps in the returned content.

### Running a command (multi-skill workflow)

```
pm_run_command({ name: "write-prd", argument: "Team inbox redesign" })
```

Or use the guided prompt version: `pm_write_prd`

### Available commands

| Command | Purpose |
|---------|---------|
| write-prd | Create decision-ready PRDs |
| discover | Run discovery from problem framing to validation |
| strategy | Build product strategy end-to-end |
| plan-roadmap | Convert strategy into sequenced roadmaps |
| prioritize | Select initiatives with context-appropriate methods |
| leadership-transition | Guide PM career progression |

## Tech Skills Protocol

Technical architecture skills for system design, decomposition, ADRs, security modeling, and migration planning.

### Finding the right skill

```
tech_search({ query: "domain analysis" })
tech_search({ type: "component" })
tech_search({ theme: "architecture-design" })
```

Or browse the full catalog: `tech://catalog`

### Using a skill

```
tech_skill({ name: "domain-analysis" })
```

Follow the Application steps in the returned content.

### Running a command (multi-skill workflow)

```
tech_run_command({ name: "design-system", argument: "Order processing service" })
```

Or use the guided prompt version: `tech_design_system`

### Available commands

| Command | Purpose |
|---------|---------|
| design-system | Design system architecture from domain analysis to documentation |
| write-adr | Create ADRs with red-teaming evaluation |
| modernize | Plan legacy system migration with phased roadmap |
| secure | Run security architecture review |
| spec-to-code | Take a feature from specification through task breakdown |

## UIUX Design Protocol

UI/UX design intelligence: styles, color palettes, typography, UX guidelines, and framework-specific best practices.

### Searching for design guidance

```
uiux_search({ query: "SaaS dashboard dark mode" })
uiux_search({ query: "minimalist", domain: "style" })
```

Domain is auto-detected from the query. Falls back across all domains if no match.

### Framework-specific guidelines

```
uiux_search_stack({ query: "form validation", stack: "react" })
```

### Generating a design system

```
uiux_generate({ query: "fintech app for millennials" })
```

Returns style, colors (semantic tokens), typography, reasoning, and landing pattern with confidence level and explanations.

### Checking UX rules

```
uiux_check_rules({ description: "login form", categories: ["accessibility", "forms"] })
```

### Running workflow commands

```
uiux_run_command({ name: "design-sprint", argument: "SaaS analytics dashboard with React" })
```

Or use guided prompts: `uiux_design_sprint`, `uiux_ux_review`, `uiux_landing_design`

### Available commands

| Command | Purpose |
|---------|---------|
| design-sprint | Full design sprint from product to implementation-ready spec |
| ux-review | Structured UX audit with prioritized findings |
| landing-design | Conversion-optimized landing page design |

### Available domains

| Domain | Content |
|--------|---------|
| style | 84 UI styles with implementation checklists |
| color | 161 semantic color palettes (WCAG-compliant) |
| typography | 57 font pairings with Google Fonts URLs |
| product | 161 product type recommendations |
| ux | 99 UX guidelines with Do/Don't |
| reasoning | 161 decision rules with JSON logic |
| chart | 25 chart types with accessibility grades |
| landing | Landing page patterns |
| icons | Icon recommendations |

### Available stacks (16)

react, nextjs, vue, svelte, astro, swiftui, react-native, flutter, nuxtjs, nuxt-ui, html-tailwind, shadcn, jetpack-compose, threejs, angular, laravel

## Inovar Module

Adapter for the Kanban Inovar public API. Fetches tickets for context enrichment.

### Setup
1. Create `.lad/secrets/inovar.json` with your API key:
   ```json
   { "apiKey": "ink_your_key" }
   ```
   Or set env var: `INOVAR_API_KEY`

> Base URL: `https://inovar.liveoficial.ind.br` (apenas o domínio, sem `/api`).
> O path `/api/public/{version}` é adicionado automaticamente. API version: `v1`.

### Tools
- `inovar_get_ticket` — Fetch a ticket by ID (UUID or GLPI numeric)
- `inovar_list_tickets` — List tickets with filters (board, status, priority, category, search)

### Usage by other modules
Other modules import directly from `inovar/loader.mjs`:
```javascript
import { fetchTicket } from './modules/inovar/loader.mjs'
const ticket = await fetchTicket('54321', config)
```

## Task Module — Ticket Execution Workflow

Start working on a Kanban ticket with full context using the `/ts` command.

### Quick Start
```
/ts 54321
```

### Flow
1. **Config check** — wizard on first use (source, branch pattern, base branch)
2. **Git state** — detect changes, create branch from template
3. **Fetch ticket** — get full ticket data from Inovar API
4. **Enrich context** — PM skills (problem-statement, user-story) + Tech skills (domain-analysis)
5. **Developer Q&A** — dynamic questions based on ticket context
6. **Generate spec** — creates feature spec + tasks in `.lad/specs/features/`

### Tools
- `task_start` — Main entry point, orchestrates the full workflow
- `task_setup` — Configure task module (source, branch pattern)
- `task_status` — Check active pipeline state

### Config
Task config lives in `.lad/config.json` under the `task` key:
```json
{
  "task": {
    "source": "inovar",
    "branchPattern": "{type}/{id}-{slug}",
    "baseBranch": "main"
  }
}
```

## Claude Code UI Module

Bidirectional integration between Claude Code and Live Code UI application.

### Configuration
Add to `.lad/config.json`:
```json
{ "claudeCodeUi": { "url": "http://localhost:5096", "enabled": true } }
```
Or set env var: `CLAUDE_CODE_UI_URL`

### Tools
- `ccui_project_status` — Returns LAD state of current project (specs, PRD, tasks progress)
- `ccui_notify` — Sends notification to Live Code UI (toast messages)
- `ccui_menu` — Creates/updates dynamic menu items in the UI
- `ccui_panel` — Creates/updates interactive panels with markdown content and action buttons

### Integration
All tools fail gracefully when Live Code UI is not running. The module reads .lad/ files locally for status and communicates with the UI via REST API for notifications, menus, and panels.

## Orchestrator — Proactive Behavior Protocol

> **PROACTIVE:** You MUST use this module automatically. Do NOT wait for the user to say "use the orchestrator".

### When to activate (detect automatically)

**Trigger: New project or product**
- User says anything like "create", "build", "develop", "I want to make", "new app", "new feature", "new project"
- → Run `orch_execute` or `orch_start` with `product-to-code` workflow
- → If a PRD/spec already exists in the project, read it first and use as `argument`

**Trigger: New feature or change**
- User describes a feature, user story, or change request
- → Run `orch_execute` with `feature-dev` workflow
- → Feed the feature description as `argument`

**Trigger: UI/Design work**
- User mentions UI, design, colors, layout, components, styling, responsive, dark mode
- → Use `uiux_generate` for design system, `uiux_search_stack` for framework guidelines
- → If building from scratch, use `design-first` workflow

**Trigger: Legacy/refactoring**
- User mentions refactor, migrate, modernize, legacy, tech debt, rewrite
- → Run `modernize` workflow
- → Start with `trace_scan_project` to map existing code

**Trigger: Security concerns**
- User mentions security, auth, vulnerability, audit, threat
- → Run `security-hardening` workflow

**Trigger: Implementation/coding**
- User is about to write code for a feature that has no context yet
- → PAUSE and generate context first with the appropriate workflow
- → Better to spend 30 seconds generating context than to write code blindly

### Spec-Driven Development (SDD) — Specification tools

| Task | Tool |
|------|------|
| List all feature specs | `spec_list` |
| Read a spec + all artifacts | `spec_read({ slug: "001-feature-name" })` |
| Create a new feature spec | `spec_create({ name: "...", description: "...", requirements: [...] })` |
| Update a spec section | `spec_update({ slug: "001-...", section: "Requirements", content: "..." })` |
| Create/update design doc | `spec_design({ slug: "001-...", content: "..." })` |
| Quick task (<=3 files) | `spec_quick({ description: "...", files: [...] })` |
| Generate task breakdown | `spec_tasks({ slug: "001-..." })` |
| Mark task done/skipped/blocked | `spec_task_status({ slug: "001-...", task: 1, status: "done" })` |
| Archive completed spec | `spec_archive({ slug: "001-...", milestone: "v0.9" })` |
| List archived specs | `spec_list({ scope: "archive" })` |
| Change spec status | `spec_status({ slug: "001-...", status: "ready" })` |
| Get next task to execute | `spec_next_task({ slug: "001-..." })` |

**SDD Lifecycle:** draft → ready → in-progress → done
- Orchestrator workflows automatically create specs in `.lad/specs/features/`
- Each spec has traceable requirement IDs (REQ-NNN.M)
- `spec_tasks` generates atomic task breakdown with file targets and verification criteria
- `spec_task_status` tracks execution progress per task
- Use `spec_quick` for bug fixes and small changes that don't need the full pipeline

### Granular use (individual modules)

When you need specific capabilities without a full workflow:

| Need | Use |
|------|-----|
| Understand existing code flows | `trace_scan_project`, `trace_scan_route` |
| Check impact before editing | `std_check_impact` |
| Write a PRD or user stories | `pm_run_command({ name: "write-prd" })` |
| Design system architecture | `tech_run_command({ name: "design-system" })` |
| Get color palette or style | `uiux_generate` or `uiux_search` |
| Framework-specific guidelines | `uiux_search_stack({ stack: "react" })` |
| Check UX rules | `uiux_check_rules` |
| Review code quality | `std_review` |

### Two execution modes

**Autonomous** (when user wants fast results):
```
orch_execute({ workflow: "product-to-code", argument: "...", stack: "react" })
```

**Assisted** (when user wants to enrich with their knowledge):
```
orch_start({ workflow: "product-to-code", argument: "..." })
→ Ask user the returned questions
orch_continue({ workspace_id: "...", answers: { ... } })
→ Repeat until complete
orch_context({ workspace_id: "..." })
→ Get final accumulated context
```

### Output

All workflows produce `.lad/workspace/{id}/context.md` — the implementation-ready context document.
