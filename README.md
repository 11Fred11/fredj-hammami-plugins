# claude-mods

A Claude Code plugin marketplace of small, quiet mods.

| Plugin | What it does |
| --- | --- |
| [cockpit](plugins/cockpit) | A band above the prompt: model, effort, context %, cost, current task and live subagents |

## Install

```
claude plugin marketplace add 11Fred11/claude-mods
claude plugin install cockpit@fredj-mods
```

Update later with `claude plugin marketplace update fredj-mods` and `claude plugin update cockpit@fredj-mods`.

## Releasing

1. Bump `version` in the plugin's `.claude-plugin/plugin.json` and its entry in `.claude-plugin/marketplace.json`.
2. `claude plugin validate .` and `claude plugin test plugins/<name>`.
3. `claude plugin validate --strict plugins/<name>`, then commit and push.
4. Optionally tag it: `claude plugin tag plugins/<name> --push`.

Never change a published plugin's `name`; set `displayName` for a new label. A rename needs an entry under `renames` in `marketplace.json`, as `agent-hud` → `cockpit` has.
