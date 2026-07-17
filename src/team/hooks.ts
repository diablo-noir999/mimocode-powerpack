/**
 * Auto-assign tasks to available agents
 * 
 * Simplified from oh-my-opencode's team-mode hooks.
 * Provides hooks for task assignment and team coordination.
 */

import type { Task, TasklistConfig } from "./tasklist"
import { listTasks, claimTask } from "./tasklist"

export interface TeamHooksConfig {
  enabled: boolean
  autoAssign?: boolean
}

export interface Agent {
  name: string
  status: "idle" | "busy" | "offline"
}

export interface TeamState {
  agents: Agent[]
  tasks: Task[]
}

/**
 * Get available agents (idle status)
 */
export function getAvailableAgents(agents: Agent[]): Agent[] {
  return agents.filter(agent => agent.status === "idle")
}

/**
 * Auto-assign pending tasks to available agents
 * Returns list of assignments made
 */
export async function autoAssignTasks(
  teamRunId: string,
  agents: Agent[],
  config: TasklistConfig,
): Promise<Array<{ taskId: string; agentName: string }>> {
  const assignments: Array<{ taskId: string; agentName: string }> = []
  const availableAgents = getAvailableAgents(agents)
  
  if (availableAgents.length === 0) {
    return assignments
  }

  // Get pending tasks
  const pendingTasks = await listTasks(teamRunId, config, { status: "pending" })
  
  // Simple round-robin assignment
  for (let i = 0; i < pendingTasks.length && i < availableAgents.length; i++) {
    const task = pendingTasks[i]
    const agent = availableAgents[i]

    try {
      await claimTask(teamRunId, task.id, agent.name, config)
      assignments.push({ taskId: task.id, agentName: agent.name })
    } catch {
      // Task already claimed, continue
    }
  }

  return assignments
}

/**
 * Hook handler for task assignment
 * Called on session.idle or similar events
 */
export function createAutoAssignHook(
  teamRunId: string,
  agents: Agent[],
  config: TasklistConfig,
) {
  return async () => {
    return autoAssignTasks(teamRunId, agents, config)
  }
}
