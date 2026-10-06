import { expect, mock, test } from 'claude-code/testing'

import { ctxColor, ctxLimits, ctxRuns, describeCall, fmtElapsed, fmtTokens, parseLimit, shortModel } from '../hooks/register'

const DEFAULTS = ctxLimits('30%', '50%', 200_000)

const SURFACES = ['terminal', 'desktop'] as const

const band = (surface: (typeof SURFACES)[number], isWorking = true) => ({
  plugin: 'cockpit',
  surface,
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking,
    maxRows: 12,
    bodyColumns: 110,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
})

const spawn = (description: string, subagentType: string) => ({
  tool_use_id: `tu-${description}`,
  prompt: 'go',
  description,
  subagentType,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
})

test('formats models, tokens, time and tool calls compactly', async () => {
  expect(shortModel('claude-opus-5-5')).toBe('opus 5.5')
  expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
  expect(fmtTokens(812)).toBe('812')
  expect(fmtTokens(41_500)).toBe('42k')
  expect(fmtTokens(1_250_000)).toBe('1.3M')
  expect(fmtElapsed(72_000)).toBe('1:12')
  expect(describeCall('Bash', { command: 'npm test\nmore' })).toBe('Bash npm test')
  expect(describeCall('Edit', { file_path: '/a/b/app.ts' })).toBe('Edit app.ts')
  expect(describeCall('mcp__linear__get_issue', {})).toBe('linear:get_issue')
})

test('colors context cells: 3 green, 2 amber, the rest red', async () => {
  expect(ctxColor(29, DEFAULTS)).toBe('success')
  expect(ctxColor(30, DEFAULTS)).toBe('warning')
  expect(ctxColor(50, DEFAULTS)).toBe('error')
  expect(ctxRuns(0, DEFAULTS)).toEqual([])
  expect(ctxRuns(28, DEFAULTS)).toEqual([{ color: 'success', cells: '▰▰▰' }])
  expect(ctxRuns(72, DEFAULTS)).toEqual([
    { color: 'success', cells: '▰▰▰' },
    { color: 'warning', cells: '▰▰' },
    { color: 'error', cells: '▰▰' },
  ])
  expect(ctxRuns(100, DEFAULTS).map(run => run.cells).join('')).toHaveLength(10)
})

test('reads limits as a share of the window or as a token count', async () => {
  expect(parseLimit('40%', 200_000)).toBe(40)
  expect(parseLimit('40', 200_000)).toBe(40)
  expect(parseLimit('100k', 200_000)).toBe(50)
  expect(parseLimit('100k', 1_000_000)).toBe(10)
  expect(parseLimit('1.2m', 2_000_000)).toBe(60)
  expect(parseLimit('120000', 1_000_000)).toBe(12)
  expect(parseLimit('lots', 200_000)).toBeUndefined()
  // Unreadable values fall back to the defaults; amber never sits past red.
  expect(ctxLimits('lots', '', 200_000)).toEqual({ warn: 30, danger: 50 })
  expect(ctxLimits('70%', '50%', 200_000)).toEqual({ warn: 50, danger: 50 })
})

test('draws the bar against the limits the person set', { options: { warnAt: '20k', dangerAt: '40k' } }, async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 50_000, window: 1_000_000, percent: 5 }, rateLimits: [] },
  }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: '', durationMs: 1, turnId: 't1', reason: 'answer', isAborted: false })

  // 5% of a 1M window is 50k tokens: past the 40k red limit.
  const ui = await $.ui.mount(band('terminal'))
  const label = (await ui.findAll({ type: 'Text', text: /5%/ })).find(el => el.text.trim() === '5%')
  expect(label?.props.color).toBe('error')
})

test('draws context, cost, the current task and a running subagent', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 72_000, window: 200_000, percent: 36 },
      rateLimits: [],
      cost: { usd: 1.42 },
    },
  }))
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5-20251001', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn(spawn('Map the auth flow', 'Explore'))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' }],
  })
  // A main-loop turn ending refreshes the cost and context figures.
  await $.turn.complete({ answer: '', durationMs: 1, turnId: 't1', reason: 'answer', isAborted: false })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ text: /36%/ })).toBeDefined()
    expect(await ui.find({ text: /\$1\.42/ })).toBeDefined()
    expect(await ui.find({ text: /Running tests/ })).toBeDefined()
    expect(await ui.find({ text: /Map the auth flow/ })).toBeDefined()
    expect(await ui.find({ text: /haiku 4\.5/ })).toBeDefined()
  }
})

test('a finished subagent drops off the band after a while', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a2' }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', () => ({ value: { command: 'cockpit' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.agent.spawn(spawn('Fix lint', 'general-purpose'))
  await $.turn.complete({ answer: 'ok', durationMs: 1, turnId: 't2', reason: 'answer', isAborted: false, agentId: 'a2' })

  const ui = await $.ui.mount(band('terminal', false))
  expect(await ui.find({ text: /✓/ })).toBeDefined()

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(25_000)
  expect(await ui.find({ text: /Fix lint/ })).toBeUndefined()
})
