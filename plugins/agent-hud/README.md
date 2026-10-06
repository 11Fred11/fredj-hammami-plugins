# agent-hud

A minimal band above the Claude Code prompt:

```
opus 5.5 · high  ctx ▰▰▰▰▱▱▱▱▱▱ 36%  $1.42  2 agents  ▸ Running tests
● Explore          haiku 4.5        Map the auth flow — Grep session      42k   0:37
✓ Plan             opus 5.5         Draft migration plan                   61k   2:03
```

- Main model and effort, context fill (3 green cells, 2 amber, the rest red), session cost, current task.
- Makes no model or network calls: every figure comes from the model's own responses and Claude Code's cost ledger.
- One row per subagent: status, type, model and effort, task and the tool it runs now, context size, elapsed time.
- Finished subagents fade off after 20 s; `/hud` toggles showing every subagent of the session.

## Install

```
claude plugin marketplace add 11Fred11/claude-mods
claude plugin install agent-hud@fredj-mods
```

Then restart Claude Code, or run `/reload-plugins` in a running session.

## Develop

```
claude plugin validate plugins/agent-hud
claude plugin test plugins/agent-hud
```

The context thresholds are `CTX_WARN_PCT` and `CTX_DANGER_PCT` at the top of `hooks/register.tsx`.

Built on Claude Code's function-hooks plugin API, which is early access and may change between releases.
