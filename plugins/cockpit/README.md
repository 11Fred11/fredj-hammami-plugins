# cockpit

A minimal band above the Claude Code prompt:

```
opus 5.5 · high  ctx ▰▰▰▰▱▱▱▱▱▱ 36%  $1.42  2 agents  ▸ Running tests
● Explore          haiku 4.5        Map the auth flow — Grep session      ▰▱▱▱▱  42k   0:37
✓ Plan             opus 5.5         Draft migration plan                   ▰▰▱▱▱  61k   2:03
```

- Main model and effort, context fill (3 green cells, 2 amber, the rest red), session cost, current task.
- Makes no model or network calls: every figure comes from the model's own responses and Claude Code's cost ledger.
- One row per subagent: status, type, model and effort, task and the tool it runs now, a 5-cell context bar colored by the same limits, context size, elapsed time. A subagent on another model than the session's is measured against a 200k window, since Claude Code reports only the main model's.
- Finished subagents fade off after 20 s; `/cockpit` toggles showing every subagent of the session.

## Requirements

- Claude Code v2.1.287 or later (mods). Tested with v2.1.289.
- A mod runs in Claude Code only. The band draws in the terminal and in the desktop app's Code tab; claude.ai chat and Cowork skip it.

## Install

```
claude plugin marketplace add 11Fred11/fredj-hammami-plugins
claude plugin install cockpit@fredj-hammami
```

Then restart Claude Code, or run `/reload-plugins` in a running session.

## Settings

Set where the context bar turns amber and red with `/plugin configure cockpit@fredj-hammami` in Claude Code, or from a shell:

```
echo '{"warnAt": "40%", "dangerAt": "120k"}' | claude plugin configure cockpit@fredj-hammami --values-stdin
```

| Setting | Default | Accepts |
| --- | --- | --- |
| `warnAt`: context amber from | `30%` | a share of the window (`40%`), or a token count (`80k`, `1.2m`) |
| `dangerAt`: context red from | `50%` | the same |

A percentage moves with the model's window. A token count stays put when you switch to a model with a larger window.

## Develop

```
claude plugin validate plugins/cockpit
claude plugin test plugins/cockpit
```

Built on Claude Code's mods API, whose events and methods can change between releases. Develop against the folder with `claude --plugin-dir plugins/cockpit`.
