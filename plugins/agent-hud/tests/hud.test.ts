import { expect, mock, test } from 'claude-code/testing'

import { ctxColor, ctxRuns, describeCall, fmtElapsed, fmtTokens, shortModel } from '../hooks/register'

const SURFACES = ['terminal', 'desktop'] as const

const band = (surface: (typeof SURFACES)[number], isWorking = true) => ({
  plugin: 'agent-hud',
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
  expect(ctxColor(29)).toBe('success')
  expect(ctxColor(30)).toBe('warning')
  expect(ctxColor(50)).toBe('error')
  expect(ctxRuns(0)).toEqual([])
  expect(ctxRuns(28)).toEqual([{ color: 'success', cells: '▰▰▰' }])
  expect(ctxRuns(72)).toEqual([
    { color: 'success', cells: '▰▰▰' },
    { color: 'warning', cells: '▰▰' },
    { color: 'error', cells: '▰▰' },
  ])
  expect(ctxRuns(100).map(run => run.cells).join('')).toHaveLength(10)
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
  on('command.register', () => ({ value: { command: 'hud' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.agent.spawn(spawn('Fix lint', 'general-purpose'))
  await $.turn.complete({ answer: 'ok', durationMs: 1, turnId: 't2', reason: 'answer', isAborted: false, agentId: 'a2' })

  const ui = await $.ui.mount(band('terminal', false))
  expect(await ui.find({ text: /✓/ })).toBeDefined()

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(25_000)
  expect(await ui.find({ text: /Fix lint/ })).toBeUndefined()
})
