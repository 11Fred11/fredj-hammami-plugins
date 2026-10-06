export type HudLoop = {
  model?: string
  effort?: string
  activity?: string
}

export type HudAgent = HudLoop & {
  id: string
  type: string
  description: string
  status: 'running' | 'done' | 'failed'
  tokens: number
  startedAt: number
  endedAt?: number
}

export type HudUsage = {
  percent?: number
  usd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-hud': {
      main: HudLoop
      task: string | null
      agents: HudAgent[]
      usage: HudUsage
      now: number
      isExpanded: boolean
    }
  }
}
