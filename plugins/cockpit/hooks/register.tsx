import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CockpitAgent, CockpitLoop, CockpitUsage } from '../types'

const main = atom({ plugin: 'cockpit', key: 'main' } as const, {})
const task = atom({ plugin: 'cockpit', key: 'task' } as const, null)
const agents = atom({ plugin: 'cockpit', key: 'agents' } as const, [])
const usage = atom({ plugin: 'cockpit', key: 'usage' } as const, {})
const now = atom({ plugin: 'cockpit', key: 'now' } as const, 0)
const isExpanded = atom({ plugin: 'cockpit', key: 'isExpanded' } as const, false)

// Finished agents stay on the band this long before they drop off.
const LINGER_MS = 20_000
const MAX_AGENT_ROWS = 6
const CTX_CELLS = 10
const DEFAULT_WARN_AT = '30%'
const DEFAULT_DANGER_AT = '50%'

// Where the context bar turns amber and red, as percentages of the window.
export type CtxLimits = { warn: number; danger: number }

// A limit as the person wrote it: "30%" (or a bare 30) is a share of the
// window; "120k", "1.2m" or a bare 120000 a token count, which holds still
// when a model with a larger window comes in.
export const parseLimit = (text: string, window: number | undefined): number | undefined => {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(%|k|m)?\s*$/i.exec(text)
  if (!match) return undefined
  const n = Number(match[1])
  const unit = match[2]?.toLowerCase() ?? (n <= 100 ? '%' : '')
  if (unit === '%') return n
  if (!window) return undefined
  const tokens = unit === 'k' ? n * 1_000 : unit === 'm' ? n * 1_000_000 : n

  return (tokens / window) * 100
}

export const ctxLimits = (warnAt: string, dangerAt: string, window: number | undefined): CtxLimits => {
  const danger = parseLimit(dangerAt, window) ?? parseLimit(DEFAULT_DANGER_AT, window)!
  const warn = parseLimit(warnAt, window) ?? parseLimit(DEFAULT_WARN_AT, window)!

  return { warn: Math.min(warn, danger), danger }
}

export const ctxColor = (pct: number, limits: CtxLimits): string =>
  pct >= limits.danger ? 'error' : pct >= limits.warn ? 'warning' : 'success'

// The filled cells in runs of one color, each cell colored by the share at its middle.
export const ctxRuns = (pct: number, limits: CtxLimits): { color: string; cells: string }[] => {
  const step = 100 / CTX_CELLS
  const filled = Math.min(CTX_CELLS, Math.round(pct / step))
  const runs: { color: string; cells: string }[] = []
  for (let i = 0; i < filled; i++) {
    const color = ctxColor((i + 0.5) * step, limits)
    const last = runs[runs.length - 1]
    if (last?.color === color) last.cells += '▰'
    else runs.push({ color, cells: '▰' })
  }

  return runs
}

export const shortModel = (id: string | undefined): string => {
  if (!id) return ''

  return id
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')
}

export const shortEffort = (effort: string | number | undefined): string | undefined => {
  if (effort === undefined) return undefined
  if (typeof effort === 'number') return `${effort}`

  return effort === 'medium' ? 'med' : effort
}

export const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

export const fmtElapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))

  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

// One short line for what a tool call is doing: "Bash npm test", "Edit app.ts".
export const describeCall = (tool: string, args: Record<string, unknown>): string => {
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined)
  const path = str('file_path') ?? str('notebook_path') ?? str('path')
  const detail =
    str('description') ??
    str('command') ??
    (path ? basename(path) : undefined) ??
    str('pattern') ??
    str('query') ??
    str('url') ??
    str('skill') ??
    str('subject')
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(1).join(':') : tool

  return clip(detail ? `${name} ${detail.split('\n')[0]}` : name, 60)
}

const loopOf = (agentId: string | undefined) => agentId ?? 'main'

const patchLoop = async ($: EngineInterface, agentId: string | undefined, patch: CockpitLoop) => {
  if (agentId === undefined) {
    await update($, main, loop => ({ ...loop, ...patch }))
    return
  }
  await update($, agents, list => list.map(a => (a.id === agentId ? { ...a, ...patch } : a)))
}

const refreshUsage = async ($: EngineInterface) => {
  const u = await $.session.usage()
  const next: CockpitUsage = { percent: u.context.percent, window: u.context.window, usd: u.cost?.usd }
  await update($, usage, () => next)
}

// Picks up agents the spawn hook missed (a reload mid-run) and their ends.
const syncAgents = async ($: EngineInterface) => {
  const listed = await $.agent.list()
  const at = await $.clock.now()
  await update($, agents, list => {
    const known = new Map(list.map(a => [a.id, a]))
    for (const info of listed) {
      if (info.teammateId) continue
      const ended = info.status === 'completed' || info.status === 'failed' || info.status === 'killed'
      const mine = known.get(info.id)
      if (!mine) {
        if (ended) continue
        known.set(info.id, {
          id: info.id,
          type: info.type,
          description: info.description,
          status: 'running',
          tokens: 0,
          startedAt: at,
        })
      } else if (ended && mine.status === 'running') {
        known.set(info.id, { ...mine, status: info.status === 'completed' ? 'done' : 'failed', endedAt: at })
      }
    }

    return [...known.values()].slice(-50)
  })
}

export const register: Register = (on, options) => {
  const warnAt = String(options.warnAt ?? DEFAULT_WARN_AT)
  const dangerAt = String(options.dangerAt ?? DEFAULT_DANGER_AT)

  const taskTitles = new Map<string, string>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cockpit',
      description: 'Toggle cockpit between compact and showing every subagent of this session',
      immediate: true,
    })
    // Figures are read from the engine's own ledger, refreshed as each model
    // response lands; nothing here polls or calls the API.
    await refreshUsage($)
    await syncAgents($)
    // The model is known before the first response; effort arrives with it.
    const model = await $.session.model()
    await update($, main, loop => (loop.model ? loop : { ...loop, model }))

    // Only moves the elapsed-time column while a subagent row is on screen.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        const at = await $.clock.now()
        const isTicking = list.some(a => a.status === 'running' || (a.endedAt ?? 0) > at - LINGER_MS - 1000)
        if (isTicking) await update($, now, () => at)
      })()
    })

    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    const was = await read($, isExpanded)
    await update($, isExpanded, () => !was)

    return { text: was ? 'cockpit: compact' : 'cockpit: showing every subagent' }
  })

  on('turn.step', async function* ($, e, next) {
    await patchLoop($, e.agentId, { model: e.model, effort: shortEffort(e.effort) })
    const result = yield* next(e)
    const u = result.usage
    if (u && e.agentId !== undefined) {
      const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      await update($, agents, list => list.map(a => (a.id === e.agentId ? { ...a, tokens: total } : a)))
    }
    await refreshUsage($)

    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId && !e.isTeammate) {
      const agent: CockpitAgent = {
        id: spawned.agentId,
        type: e.subagentType,
        description: e.description,
        model: spawned.model,
        status: 'running',
        tokens: 0,
        startedAt: await $.clock.now(),
      }
      await update($, agents, list => [...list.filter(a => a.id !== agent.id), agent].slice(-50))
      await update($, now, () => agent.startedAt)
    }

    return spawned
  })

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Record<string, unknown>
    await patchLoop($, e.agentId, { activity: describeCall(String(e.tool), args) })
    const ran = await next(e)

    // The main loop's task list names what it is working on.
    if (e.agentId === undefined && !('deny' in ran && ran.deny)) {
      if (e.tool === 'TodoWrite') {
        const doing = e.todos.find(t => t.status === 'in_progress')
        await update($, task, () => doing?.activeForm ?? null)
      } else if (e.tool === 'TaskCreate') {
        const created = (ran.result as { task?: { id: string } } | undefined)?.task
        if (created) taskTitles.set(created.id, e.activeForm ?? e.subject)
      } else if (e.tool === 'TaskUpdate') {
        const title = e.activeForm ?? e.subject ?? taskTitles.get(e.taskId)
        if (e.activeForm ?? e.subject) taskTitles.set(e.taskId, (e.activeForm ?? e.subject)!)
        if (e.status === 'in_progress' && title) await update($, task, () => title)
        if (e.status === 'completed' || e.status === 'deleted') {
          await update($, task, current => (current === title ? null : current))
        }
      }
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await patchLoop($, undefined, { activity: undefined })
      await refreshUsage($)
    } else {
      const at = await $.clock.now()
      const status = e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, list =>
        list.map(a => (a.id === e.agentId ? { ...a, status, endedAt: at, activity: undefined } : a)),
      )
    }

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const loop = await read($, main)
    const current = await read($, task)
    const list = await read($, agents)
    const u = await read($, usage)
    const at = await read($, now)
    const isAll = await read($, isExpanded)
    const width = e.props.bodyColumns

    const shown = list
      .filter(a => isAll || a.status === 'running' || (a.endedAt ?? 0) > at - LINGER_MS)
      .slice(-MAX_AGENT_ROWS)
    const running = list.filter(a => a.status === 'running').length

    const pct = u.percent
    const limits = ctxLimits(warnAt, dangerAt, u.window)
    const runs = pct === undefined ? [] : ctxRuns(pct, limits)
    const filled = runs.reduce((n, run) => n + run.cells.length, 0)
    const doing = current ?? (e.props.isWorking ? loop.activity : undefined)

    const typeWidth = Math.min(16, Math.max(...shown.map(a => a.type.length), 4))
    const modelWidth = Math.max(...shown.map(a => shortModel(a.model).length + (a.effort ? a.effort.length + 3 : 0)), 4)
    const fixed = 2 + typeWidth + 1 + modelWidth + 1 + 6 + 6 + 4
    const textWidth = Math.max(10, width - fixed)

    return (
      <Box flexDirection="column" width={width}>
        <Box gap={2}>
          {loop.model && (
            <Text>
              <Text bold>{shortModel(loop.model)}</Text>
              {loop.effort && <Text dimColor> · {loop.effort}</Text>}
            </Text>
          )}
          <Text>
            <Text dimColor>ctx </Text>
            {runs.map(run => (
              <Text color={run.color}>{run.cells}</Text>
            ))}
            <Text dimColor>{'▱'.repeat(CTX_CELLS - filled)}</Text>
            <Text color={pct === undefined ? undefined : ctxColor(pct, limits)}> {pct === undefined ? '–' : `${pct}%`}</Text>
          </Text>
          {u.usd !== undefined && <Text dimColor>${u.usd.toFixed(2)}</Text>}
          {running > 0 && <Text color="claude">{running} agent{running === 1 ? '' : 's'}</Text>}
          {doing && (
            <Box flexShrink={1}>
              <Text wrap="truncate-end" dimColor={!current}>▸ {doing}</Text>
            </Box>
          )}
        </Box>
        {shown.map(a => {
          const isRunning = a.status === 'running'
          const mark = isRunning ? '●' : a.status === 'done' ? '✓' : '✗'
          const markColor = isRunning ? 'claude' : a.status === 'done' ? 'success' : 'error'
          const label = `${shortModel(a.model)}${a.effort ? ` · ${a.effort}` : ''}`
          const what = isRunning && a.activity ? `${a.description} — ${a.activity}` : a.description

          return (
            <Box key={a.id}>
              <Text color={markColor}>{mark} </Text>
              <Box width={typeWidth + 1} flexShrink={0}>
                <Text wrap="truncate-end">{a.type}</Text>
              </Box>
              <Box width={modelWidth + 1} flexShrink={0}>
                <Text dimColor>{label}</Text>
              </Box>
              <Box width={textWidth} flexShrink={1}>
                <Text wrap="truncate-end" dimColor={!isRunning}>{what}</Text>
              </Box>
              <Box width={6} flexShrink={0} justifyContent="flex-end">
                <Text dimColor>{a.tokens ? fmtTokens(a.tokens) : ''}</Text>
              </Box>
              <Box width={6} flexShrink={0} justifyContent="flex-end">
                <Text dimColor>{fmtElapsed((a.endedAt ?? at) - a.startedAt)}</Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
