export type CockpitLoop = {
  model?: string
  effort?: string
  activity?: string
}

export type CockpitAgent = CockpitLoop & {
  id: string
  type: string
  description: string
  status: 'running' | 'done' | 'failed'
  tokens: number
  startedAt: number
  endedAt?: number
}

export type CockpitUsage = {
  percent?: number
  usd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'cockpit': {
      main: CockpitLoop
      task: string | null
      agents: CockpitAgent[]
      usage: CockpitUsage
      now: number
      isExpanded: boolean
    }
  }
}
