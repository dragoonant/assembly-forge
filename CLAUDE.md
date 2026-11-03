# Assembly Forge — agent orientation

An original 3D hex tactics game with a Timeline scheduler, the 3D successor to MegaMechaTactics. Owner credit: **evilgouki**.
Never write the owner's real name, email or home path into this repo, a commit, or anything published.

- **Read first:** `PLAN.md` (decisions D1–D10, milestones M0–M6, the rulebook-checked rules in §6), `STATUS.md` (what exists now),
  `NOTICE.md` (the IP rules this project lives by).
- **IP rules:** no unit, pilot, faction, series or product name from the source game anywhere in the repo; no published art, map
  layout, card text or frame. Names a player reads live only in `src/content/names.js`. Search a change for trademarks before
  committing.
- **Figure prompts:** follow the Mallet 42k `docs/FIGURE-STYLE.md` house style, measurements and materials only. Its banned-word list
  applies to every prompt, brief and template here.
- **Engine:** `src/engine`, `src/content`, `src/ai` are plain JavaScript with JSDoc, pure and deterministic (seeded generator in
  state, no DOM, no `Math.random`). `apply` never mutates its input. The UI derives every affordance by filtering `legalActions`.
  The TypeScript client reaches the engine only through `src/client/engine.ts`.
- **Rules changes:** check the rulebook (2026-10-30 issue) and PLAN.md §6 first, change the config in `src/engine/rules.js` or the
  engine, then add or update the test in `tests/engine/`.
- **Commands:** `npm run dev | typecheck | test | build | e2e`. `npm test` runs the engine harness (`tests/engine/run.js`) and Vitest
  (`tests/unit`). `npm run e2e` builds, previews under `/assembly-forge/` and runs Playwright; screenshots land in `e2e-out/`.
  Set `PW_PORT` if 5311 is taken.
- **Verify 3D by screenshot:** a scene change is not done until an e2e screenshot of it has been looked at.
- **Git:** `main` deploys to GitHub Pages on push. Gate the commit (typecheck, test, build, e2e) before pushing.
