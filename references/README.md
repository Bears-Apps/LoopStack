# LoopStack references

Inspect this folder before building new UI. It records decisions that are
already settled so they get reused rather than re-litigated or quietly
contradicted.

## What is authoritative

| Source | Authority | Use it for |
|---|---|---|
| `src/styles/tokens.css` | **Authoritative** | Every colour, type, spacing, radius, motion, and interaction value. Nothing in this folder overrides it. |
| `core-ui-elements/` | **Authoritative** | Why a pattern exists, when to use it, when not to, and what states it must carry. |
| `docs/` | Authoritative for product | Brand, IA, screens, data model, principles, visual system, TestFlight runbook. |
| `inspiration/` | **Not authoritative** | Saved visual references. Read for pattern logic, never copied verbatim. |

When this folder and the code disagree, the code is what shipped — fix
whichever one is wrong and say which in the commit.

## Structure

```
references/
  README.md                 this file
  core-ui-elements/
    README.md               index of foundational UI decisions
    components/             single components: purpose, anatomy, variants, states
    patterns/               multi-component interaction and layout patterns
    states/                 loading, empty, error, and product-specific states
    responsive/             breakpoint and adaptive behaviour
    accessibility/          focus, motion, tap targets, non-colour state signals
    code-snippets/          approved implementation examples and known traps
  inspiration/              saved visual references (not authoritative)
```

## Rules for adding to this folder

- Add a file when a decision becomes **reusable**, not when a component is
  merely finished.
- Every entry states: when to use it, when **not** to use it, supported states,
  responsive behaviour, and implementation notes.
- Do not restate source code. If a file could be replaced by reading the
  component, it should not exist. Record the *reasoning* the code cannot carry.
- Prefer local code over shared abstraction until reuse is demonstrated. This
  folder documents patterns that earned reuse, not aspirational ones.
