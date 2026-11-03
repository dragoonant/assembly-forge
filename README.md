# Assembly Forge

An original 3D hex tactics game for the browser. Squads of three machines fight over objectives on a hex board, and every
action costs time on a shared Timeline: a heavy weapon hits harder but leaves the machine waiting longer for its next turn.

**Unofficial, non-commercial fan project by evilgouki.** It implements the rules system of a published mecha miniatures game.
All names, art, models, text and audio are original. See [`NOTICE.md`](NOTICE.md).

Status: early scaffold (milestone M0). See [`PLAN.md`](PLAN.md) for the roadmap and [`STATUS.md`](STATUS.md) for what works.

```bash
npm install
npm run dev        # play locally
npm test           # engine and unit tests
npm run e2e        # browser smoke test with screenshots
```

## Layout

```
src/engine    pure rules engine: legalActions, apply, seeded dice, the Timeline
src/content   the six machines, Tactics cards, teams, the scenario, every display name
src/ai        the opponent
src/client    React Three Fiber board, camera and (soon) the HUD
tests         engine harness, Vitest unit tests, Playwright e2e
tools         AI self-play and head-to-head
docs          rules reconstruction and the open-rules checklist
```
