# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Benefits Signal design decisions

- Keep the digest intentionally quiet and editorial, with a narrow centered reading column and no dashboard chrome.
- The scan view shows only Now / Next / Watch, a status or operative date, a short implication, and one disclosure action.
- Topic, jurisdiction, plan-type, confidence, supporting passage, and source metadata appear only inside an opened briefing.
- Routine high-confidence labels stay hidden from the scan view; uncertainty is visible only when it changes how a reader should treat an item.
- The source log is a paralegal quality-control view and must preserve kept, merged, and omitted items.
- Monitor seven sources: EBIA Weekly, Mercer Law & Policy Group, Segal Compliance News, Groom, Trucker Huss, Wagner Law Group, and Word on Benefits by the International Foundation of Employee Benefit Plans.
- Treat the seven publications as a curated interpretation layer, not the organizing system; primary-authority feeds are a separate evidence layer.
- Populate the digest from four saved scans: Federal Health & Welfare, Multiemployer & Taft-Hartley, California & Ninth Circuit, and Cybersecurity & Privacy.
- An opened briefing should explain who is affected, what may need to happen, by when, which scan matched, which sources were merged, and the suggested human-triggered next step.
- Do not automate external legal work in the prototype. Downstream actions prepare an internal draft or review item and visibly require attorney review.
