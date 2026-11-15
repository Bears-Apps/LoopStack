# Working on LoopStack

The system is the source for everything visual and everything a person reads
here. Read it before you build, and check against it before you finish.

- **The rules:** DESIGN.md (tokens, type, glass, data visuals, named rules) and
  PRODUCT.md (who it's for, positioning, clinical safety, the process stated
  once). Neither is decoration; when code and these disagree, ask which one is
  wrong. Detail behind them: `docs/visual-system.md`, `docs/brand.md`,
  `docs/principles.md`, `docs/desktop/brief.md`.
- **The MCP server:** `loopstack-system` (registered in .mcp.json,
  `node scripts/system/mcp.mjs`). Zero dependencies, read-only, and it reads
  this working tree live.
  - Before adding UI: `search_system`, then `get_component` on anything close.
    Reuse or extend first.
  - For colours: `find_tokens`. A raw hex outside `src/styles/tokens.css` is
    drift.
  - Before any chart: `get_rules "Data visuals"`.
  - Before finishing a change to code: `check_source`. For copy: `check_copy`.
  - Before committing: `review_change` (same as `npm run system:review`).
  - For the why: `get_research` (16 topics, 284 sources) and `get_decisions`.
- **Three sizes:** sketch, playground, production. `get_checklist` says how
  much to check at each. Don't govern a sketch like production, and don't ship
  a playground idea without the production checklist.
- **What blocks:** `npm run system:review` judges only the lines a change adds.
  These stop a change: a dosing instruction (SAFE-1), copy suggesting the app
  changes the pump or Loop (SAFE-3), AI settings advice (SAFE-5), a raw colour
  that has a token, an image without alt, a positive tabIndex. Everything else
  is reported for a person to answer. `npm test` and `npm run build` gate
  TestFlight.
- **Existing drift:** `audit_drift` counts what predates the gate. Fix it when
  you're in the file; don't let it grow.
- **The registry:** `src/data/system-registry.json` is what the system has
  taken on. A new component in `src/components/` gets an entry with its size
  and where it's documented.
- **Sizes, tools and gates** live in `src/data/system-agents.json`. Edit there
  and the server and the gate both change.
- **Tests for the gate:** `npm run system:test`.
