/**
 * team_status tool - Show team state, task list
 * 
 * Simplified from oh-my-opencode's team-mode query tools.
 */

import { tool } from "@mimo-ai/plugin"
import type { TasklistConfig, TaskStatus } from "../team/tasklist"
import { listTasks } from "../team/tasklist"
import { listUnreadMessages } from "../team/mailbox"
import type { MailboxConfig } from "../team/mailbox"

export interface TeamStatusToolConfig {
  enabled: boolean
  baseDir: string
}

export function createTeamStatusTool(config: TeamStatusToolConfig) {
  if (!config.enabled) {
    return null
  }

  const tasklistConfig: TasklistConfig = {
    baseDir: config.baseDir,
  }

  const mailboxConfig: MailboxConfig = {
    baseDir: config.baseDir,
  }

  return tool({
    description: "Show team status including tasks and mailbox.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      agentName: tool.schema.string().optional().describe("Specific agent to check (optional)"),
    },
    execute: async (args: {
      teamRunId: string
      agentName?: string
    }) => {
      // Get all tasks
      const tasks = await listTasks(args.teamRunId, tasklistConfig)

      // Get task summary by status
      const taskSummary: Record<TaskStatus, number> = {
        pending: 0,
        claimed: 0,
        in_progress: 0,
        completed: 0,
        deleted: 0,
      }
      for (const task of tasks) {
        taskSummary[task.status]++
      }

      // Get unread message counts if agent specified
      let unreadMessages = 0
      if (args.agentName) {
        const messages = await listUnreadMessages(args.teamRunId, args.agentName, mailboxConfig)
        unreadMessages = messages.length
      }

      return JSON.stringify({
        teamRunId: args.teamRunId,
        tasks: {
          total: tasks.length,
          summary: taskSummary,
          items: tasks.slice(0, 20), // Limit to 20 tasks for display
        },
        unreadMessages,
        agentName: args.agentName,
      })
    },
  })
}
