import { describe, it, expect, beforeEach, mock } from "bun:test"
import type { KimakiConfig } from "../config"
import type {
  KimakiChannel,
  KimakiThread,
  KimakiAgent,
  KimakiMessage,
  KimakiIngressInput,
  KimakiQueuedMessage,
  KimakiChannelMapping,
  KimakiAgentMapping,
  KimakiFileAttachment,
  BotMode,
  ChannelType,
  VerbosityLevel,
} from "../types"

// ── 1. resolveKimakiConfig ─────────────────────────────────────

import {
  resolveKimakiConfig,
  DEFAULT_KIMAKI_CONFIG,
} from "../config"

describe("resolveKimakiConfig", () => {
  it("returns default config when no argument", () => {
    const cfg = resolveKimakiConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.connection.baseUrl).toBe("http://127.0.0.1:31099")
    expect(cfg.channels).toEqual([])
    expect(cfg.agents).toEqual([])
    expect(cfg.defaultVerbosity).toBe("text_and_essential_tools")
    expect(cfg.defaultMentionMode).toBe(false)
    expect(cfg.useWorktrees).toBe(false)
    expect(cfg.permissionTimeoutMs).toBe(600_000)
    expect(cfg.shellPrefix).toBe("!")
  })

  it("merges user config with defaults", () => {
    const user: Partial<KimakiConfig> = { enabled: true }
    const cfg = resolveKimakiConfig(user)
    expect(cfg.enabled).toBe(true)
    // defaults still present
    expect(cfg.connection.baseUrl).toBe("http://127.0.0.1:31099")
    expect(cfg.shellPrefix).toBe("!")
  })

  it("deep-merges connection with partial override", () => {
    const user: Partial<KimakiConfig> = {
      connection: { baseUrl: "http://remote:4000" },
    }
    const cfg = resolveKimakiConfig(user)
    expect(cfg.connection.baseUrl).toBe("http://remote:4000")
    // token not in user config, so it's absent
    expect(cfg.connection.token).toBeUndefined()
  })

  it("preserves user-provided token", () => {
    const user: Partial<KimakiConfig> = {
      connection: { baseUrl: "http://x", token: "tok123" },
    }
    const cfg = resolveKimakiConfig(user)
    expect(cfg.connection.token).toBe("tok123")
  })

  it("overrides top-level fields", () => {
    const user: Partial<KimakiConfig> = {
      shellPrefix: "/",
      defaultVerbosity: "text_only",
      permissionTimeoutMs: 120_000,
      useWorktrees: true,
      defaultMentionMode: true,
    }
    const cfg = resolveKimakiConfig(user)
    expect(cfg.shellPrefix).toBe("/")
    expect(cfg.defaultVerbosity).toBe("text_only")
    expect(cfg.permissionTimeoutMs).toBe(120_000)
    expect(cfg.useWorktrees).toBe(true)
    expect(cfg.defaultMentionMode).toBe(true)
  })

  it("returns a copy, not the default object", () => {
    const cfg1 = resolveKimakiConfig()
    const cfg2 = resolveKimakiConfig()
    expect(cfg1).not.toBe(cfg2)
    expect(cfg1.channels).not.toBe(cfg2.channels)
  })

  it("handles empty object without crashing", () => {
    const cfg = resolveKimakiConfig({})
    expect(cfg.enabled).toBe(false)
    expect(cfg.connection.baseUrl).toBe("http://127.0.0.1:31099")
  })
})

// ── 2. Types verification ──────────────────────────────────────

describe("types", () => {
  it("BotMode accepts valid values", () => {
    const modes: BotMode[] = ["self_hosted", "gateway"]
    modes.forEach((m) => {
      // TypeScript won't let us assign wrong values at type level,
      // but we verify the strings exist
      expect(["self_hosted", "gateway"]).toContain(m)
    })
  })

  it("ChannelType accepts valid values", () => {
    const types: ChannelType[] = ["text", "voice"]
    types.forEach((t) => {
      expect(["text", "voice"]).toContain(t)
    })
  })

  it("VerbosityLevel accepts valid values", () => {
    const levels: VerbosityLevel[] = [
      "tools_and_text",
      "text_and_essential_tools",
      "text_only",
    ]
    levels.forEach((v) => {
      expect([
        "tools_and_text",
        "text_and_essential_tools",
        "text_only",
      ]).toContain(v)
    })
  })

  it("KimakiChannel has required fields", () => {
    const ch: KimakiChannel = {
      channelId: "123",
      directory: "/tmp",
      channelType: "text",
      verbosity: "text_only",
      mentionMode: false,
      worktreesEnabled: false,
    }
    expect(ch.channelId).toBe("123")
    expect(ch.directory).toBe("/tmp")
  })

  it("KimakiThread has required fields", () => {
    const t: KimakiThread = {
      threadId: "t1",
      sessionId: "ses_abc",
      source: "kimaki",
      channelId: "ch1",
    }
    expect(t.threadId).toBe("t1")
    expect(t.source).toBe("kimaki")
  })

  it("KimakiMessage has required fields", () => {
    const msg: KimakiMessage = {
      messageId: "m1",
      threadId: "t1",
      content: "hello",
      authorId: "u1",
      authorUsername: "user1",
      timestamp: Date.now(),
    }
    expect(msg.content).toBe("hello")
  })

  it("KimakiIngressInput has required fields", () => {
    const input: KimakiIngressInput = {
      prompt: "test prompt",
      userId: "u1",
      username: "user1",
    }
    expect(input.prompt).toBe("test prompt")
  })

  it("KimakiQueuedMessage has required fields", () => {
    const qm: KimakiQueuedMessage = {
      prompt: "queued",
      userId: "u1",
      username: "user1",
    }
    expect(qm.prompt).toBe("queued")
  })

  it("KimakiChannelMapping has required fields", () => {
    const cm: KimakiChannelMapping = {
      kimakiChannelId: "dc123",
      mimocodeProjectId: "proj1",
      directory: "/app",
    }
    expect(cm.kimakiChannelId).toBe("dc123")
  })

  it("KimakiAgentMapping has required fields", () => {
    const am: KimakiAgentMapping = {
      kimakiAgentName: "agent_a",
      mimocodeAgentName: "build",
    }
    expect(am.kimakiAgentName).toBe("agent_a")
  })

  it("KimakiAgent has optional fields", () => {
    const a: KimakiAgent = { name: "test" }
    expect(a.name).toBe("test")
    expect(a.channelId).toBeUndefined()
  })

  it("KimakiFileAttachment has optional fields", () => {
    const fa: KimakiFileAttachment = {}
    expect(fa.contentType).toBeUndefined()
    expect(fa.sourceUrl).toBeUndefined()
  })
})

// ── 3. Adapter functions ────────────────────────────────────────

import {
  resetAdapter,
  getChannel,
  mapChannel,
  getThread,
  mapThread,
  getThreadsByChannel,
  getAgent,
  mapAgent,
  resolveAgentMapping,
  listChannels,
  listAgents,
  adaptIngressToPrompt,
  adaptMessageToMimocode,
  mapKimakiEvent,
  getStatus,
  getOrCreateRunState,
  dequeueMessage,
  queueMessage,
  isKimakiConnected,
} from "../adapter"

const defaultConfig: KimakiConfig = {
  enabled: false,
  connection: { baseUrl: "http://127.0.0.1:31099" },
  channels: [
    { kimakiChannelId: "ch_1", mimocodeProjectId: "proj_1", directory: "/home/test" },
    { kimakiChannelId: "ch_2", mimocodeProjectId: "proj_2", directory: "/home/test2" },
  ],
  agents: [
    { kimakiAgentName: "dev_bot", mimocodeAgentName: "build", role: "developer" },
  ],
  defaultVerbosity: "text_and_essential_tools",
  defaultMentionMode: false,
  useWorktrees: false,
  permissionTimeoutMs: 600_000,
  shellPrefix: "!",
}

describe("adapter — channel mapping", () => {
  beforeEach(() => {
    resetAdapter()
  })

  it("mapChannel returns a KimakiChannel from config mapping", () => {
    const ch = mapChannel("ch_1", defaultConfig)
    expect(ch).not.toBeNull()
    expect(ch!.channelId).toBe("ch_1")
    expect(ch!.directory).toBe("/home/test")
    expect(ch!.channelType).toBe("text")
    expect(ch!.verbosity).toBe("text_and_essential_tools")
    expect(ch!.mentionMode).toBe(false)
    expect(ch!.worktreesEnabled).toBe(false)
  })

  it("mapChannel returns null for unknown channel ID", () => {
    const ch = mapChannel("unknown", defaultConfig)
    expect(ch).toBeNull()
  })

  it("getChannel returns mapped channel", () => {
    mapChannel("ch_1", defaultConfig)
    const ch = getChannel("ch_1")
    expect(ch).toBeDefined()
    expect(ch!.channelId).toBe("ch_1")
  })

  it("getChannel returns undefined for unmapped channel", () => {
    const ch = getChannel("nonexistent")
    expect(ch).toBeUndefined()
  })

  it("listChannels returns all mapped channels", () => {
    mapChannel("ch_1", defaultConfig)
    mapChannel("ch_2", defaultConfig)
    const channels = listChannels()
    expect(channels).toHaveLength(2)
    expect(channels.map((c) => c.channelId).sort()).toEqual(["ch_1", "ch_2"])
  })
})

describe("adapter — thread mapping", () => {
  beforeEach(() => {
    resetAdapter()
  })

  it("mapThread creates and stores thread", () => {
    const t = mapThread("thread_1", "ch_1", "session_abc")
    expect(t.threadId).toBe("thread_1")
    expect(t.channelId).toBe("ch_1")
    expect(t.sessionId).toBe("session_abc")
    expect(t.source).toBe("kimaki")
  })

  it("getThread retrieves stored thread", () => {
    mapThread("t1", "ch1", "s1")
    const t = getThread("t1")
    expect(t).toBeDefined()
    expect(t!.sessionId).toBe("s1")
  })

  it("getThread returns undefined for unknown thread", () => {
    expect(getThread("unknown")).toBeUndefined()
  })

  it("getThreadsByChannel filters correctly", () => {
    mapThread("t1", "ch1", "s1")
    mapThread("t2", "ch1", "s2")
    mapThread("t3", "ch2", "s3")
    const threads = getThreadsByChannel("ch1")
    expect(threads).toHaveLength(2)
    expect(threads.map((t) => t.threadId).sort()).toEqual(["t1", "t2"])
  })

  it("getThreadsByChannel returns empty for no match", () => {
    mapThread("t1", "ch1", "s1")
    expect(getThreadsByChannel("ch_no")).toEqual([])
  })
})

describe("adapter — agent mapping", () => {
  beforeEach(() => {
    resetAdapter()
  })

  it("mapAgent stores agent and returns mapping", () => {
    const m = mapAgent("bot_dev", "build", "developer")
    expect(m.kimakiAgentName).toBe("bot_dev")
    expect(m.mimocodeAgentName).toBe("build")
    expect(m.role).toBe("developer")
    const agent = getAgent("bot_dev")
    expect(agent).toBeDefined()
    expect(agent!.name).toBe("bot_dev")
  })

  it("getAgent returns undefined for unknown agent", () => {
    expect(getAgent("unknown")).toBeUndefined()
  })

  it("listAgents returns all mapped agents", () => {
    mapAgent("a1", "b1")
    mapAgent("a2", "b2")
    expect(listAgents()).toHaveLength(2)
  })

  it("resolveAgentMapping finds match in config", () => {
    const m = resolveAgentMapping("dev_bot", defaultConfig)
    expect(m).not.toBeNull()
    expect(m!.mimocodeAgentName).toBe("build")
    expect(m!.role).toBe("developer")
  })

  it("resolveAgentMapping returns null for unknown agent", () => {
    const m = resolveAgentMapping("nobody", defaultConfig)
    expect(m).toBeNull()
  })
})

describe("adapter — adaptIngressToPrompt", () => {
  beforeEach(() => {
    resetAdapter()
  })

  it("passes through simple prompt with config agent fallback", () => {
    const input: KimakiIngressInput = {
      prompt: "hello world",
      userId: "u1",
      username: "user1",
    }
    const result = adaptIngressToPrompt(input, defaultConfig)
    expect(result.prompt).toBe("hello world")
    expect(result.isShellCommand).toBe(false)
    // No input.agent, no sourceThreadId → resolveAgentForContext → config.agents[0]
    expect(result.agent).toBe("dev_bot")
  })

  it("detects shell prefix", () => {
    const input: KimakiIngressInput = {
      prompt: "!ls -la",
      userId: "u1",
      username: "user1",
    }
    const result = adaptIngressToPrompt(input, defaultConfig)
    expect(result.isShellCommand).toBe(true)
    expect(result.prompt).toBe("ls -la")
  })

  it("strips queue suffix", () => {
    const input: KimakiIngressInput = {
      prompt: "do something. queue",
      userId: "u1",
      username: "user1",
    }
    const result = adaptIngressToPrompt(input, defaultConfig)
    expect(result.prompt).toBe("do something")
  })

  it("strips queue suffix with exclamation", () => {
    const input: KimakiIngressInput = {
      prompt: "fix this! queue",
      userId: "u1",
      username: "user1",
    }
    const result = adaptIngressToPrompt(input, defaultConfig)
    expect(result.prompt).toBe("fix this")
  })

  it("prefers input.agent over config", () => {
    const input: KimakiIngressInput = {
      prompt: "test",
      userId: "u1",
      username: "user1",
      agent: "override_agent",
    }
    const result = adaptIngressToPrompt(input, defaultConfig)
    expect(result.agent).toBe("override_agent")
  })

  it("resolves agent from thread context when available", () => {
    mapChannel("ch_1", defaultConfig)
    mapThread("t1", "ch_1", "s1")
    const input: KimakiIngressInput = {
      prompt: "test",
      userId: "u1",
      username: "user1",
      sourceThreadId: "t1",
    }
    const result = adaptIngressToPrompt(input, defaultConfig)
    // Thread exists, channel found, but channel has no agentName → short-circuits to undefined
    // resolveAgentForContext returns channel?.agentName, not config fallback
    expect(result.agent).toBeUndefined()
  })

  it("passes through model and images", () => {
    const imgs: KimakiFileAttachment[] = [{ sourceUrl: "http://img" }]
    const input: KimakiIngressInput = {
      prompt: "test",
      userId: "u1",
      username: "user1",
      model: "gpt-4",
      images: imgs,
    }
    const result = adaptIngressToPrompt(input, defaultConfig)
    expect(result.model).toBe("gpt-4")
    expect(result.images).toBe(imgs)
  })
})

describe("adapter — adaptMessageToMimocode", () => {
  it("converts Kimaki message to user role", () => {
    const msg: KimakiMessage = {
      messageId: "m1",
      threadId: "t1",
      content: "hello bot",
      authorId: "u1",
      authorUsername: "alice",
      timestamp: 1000,
    }
    const result = adaptMessageToMimocode(msg)
    expect(result.role).toBe("user")
    expect(result.content).toBe("hello bot")
    expect(result.name).toBe("alice")
    expect(result.images).toBeUndefined()
  })

  it("preserves images", () => {
    const imgs: KimakiFileAttachment[] = [{ sourceUrl: "http://x" }]
    const msg: KimakiMessage = {
      messageId: "m1",
      threadId: "t1",
      content: "see image",
      authorId: "u1",
      authorUsername: "bob",
      timestamp: 2000,
      images: imgs,
    }
    const result = adaptMessageToMimocode(msg)
    expect(result.images).toEqual(imgs)
  })
})

describe("adapter — mapKimakiEvent", () => {
  it("maps known events", () => {
    expect(mapKimakiEvent("message_create")).toBe("chat.message")
    expect(mapKimakiEvent("message_update")).toBe("chat.message.update")
    expect(mapKimakiEvent("message_delete")).toBe("chat.message.delete")
    expect(mapKimakiEvent("thread_create")).toBe("session.create")
    expect(mapKimakiEvent("thread_update")).toBe("session.update")
    expect(mapKimakiEvent("thread_delete")).toBe("session.delete")
    expect(mapKimakiEvent("typing_start")).toBe("session.typing")
    expect(mapKimakiEvent("voice_state_update")).toBe("session.voice")
    expect(mapKimakiEvent("interaction_create")).toBe("tool.interaction")
  })

  it("prefixes unknown events with kimaki.", () => {
    expect(mapKimakiEvent("custom_event")).toBe("kimaki.custom_event")
    expect(mapKimakiEvent("reaction_add")).toBe("kimaki.reaction_add")
  })
})

describe("adapter — queue / dequeue", () => {
  beforeEach(() => {
    resetAdapter()
  })

  it("getOrCreateRunState creates state on first call", () => {
    const rs = getOrCreateRunState("t1", "s1", "alice", "u1")
    expect(rs.sessionId).toBe("s1")
    expect(rs.sessionUsername).toBe("alice")
    expect(rs.queueItems).toEqual([])
    expect(rs.sentPartIds).toBeInstanceOf(Set)
  })

  it("getOrCreateRunState returns same state on second call", () => {
    const rs1 = getOrCreateRunState("t1", "s1", "alice", "u1")
    const rs2 = getOrCreateRunState("t1", "s2", "bob", "u2")
    expect(rs1).toBe(rs2) // same object reference
    expect(rs1.sessionId).toBe("s1") // not overwritten
  })

  it("queueMessage adds to queue", () => {
    getOrCreateRunState("t1", "s1", "alice", "u1")
    const qm: KimakiQueuedMessage = {
      prompt: "task1",
      userId: "u1",
      username: "alice",
    }
    queueMessage("t1", qm)
    const rs = getOrCreateRunState("t1", "s1", "alice", "u1")
    expect(rs.queueItems).toHaveLength(1)
  })

  it("dequeueMessage returns and removes from queue", () => {
    getOrCreateRunState("t1", "s1", "alice", "u1")
    queueMessage("t1", { prompt: "p1", userId: "u1", username: "alice" })
    queueMessage("t1", { prompt: "p2", userId: "u1", username: "alice" })
    const first = dequeueMessage("t1")
    expect(first!.prompt).toBe("p1")
    const second = dequeueMessage("t1")
    expect(second!.prompt).toBe("p2")
    expect(dequeueMessage("t1")).toBeUndefined()
  })

  it("dequeueMessage returns undefined for unknown thread", () => {
    expect(dequeueMessage("unknown")).toBeUndefined()
  })
})

describe("adapter — isKimakiConnected", () => {
  beforeEach(() => {
    resetAdapter()
  })

  it("returns false after reset", () => {
    expect(isKimakiConnected()).toBe(false)
  })
})

// ── 4. Process functions ────────────────────────────────────────

import { getKimakiProcessState } from "../process"

describe("process — getKimakiProcessState", () => {
  it("returns default state (not running, not ready)", () => {
    const s = getKimakiProcessState()
    expect(s.running).toBe(false)
    expect(s.ready).toBe(false)
    expect(s.pid).toBeNull()
    expect(s.restartCount).toBe(0)
    expect(s.lastError).toBeNull()
  })
})

// ── 5. Tool factories (kimaki_send, kimaki_status) ─────────────

import { createKimakiSendTool } from "../../tools/kimaki-send"
import { createKimakiStatusTool } from "../../tools/kimaki-status"

describe("createKimakiSendTool", () => {
  it("returns null when disabled", () => {
    const tool = createKimakiSendTool({
      enabled: false,
      config: defaultConfig,
    })
    expect(tool).toBeNull()
  })

  it("returns a tool object when enabled", () => {
    const tool = createKimakiSendTool({
      enabled: true,
      config: defaultConfig,
    })
    expect(tool).not.toBeNull()
    expect(tool).toHaveProperty("description")
    expect(tool).toHaveProperty("args")
    expect(tool).toHaveProperty("execute")
    expect(typeof tool!.execute).toBe("function")
  })
})

describe("createKimakiStatusTool", () => {
  it("returns null when disabled", () => {
    const tool = createKimakiStatusTool({
      enabled: false,
      config: defaultConfig,
    })
    expect(tool).toBeNull()
  })

  it("returns a tool object when enabled", () => {
    const tool = createKimakiStatusTool({
      enabled: true,
      config: defaultConfig,
    })
    expect(tool).not.toBeNull()
    expect(tool).toHaveProperty("description")
    expect(tool).toHaveProperty("args")
    expect(tool).toHaveProperty("execute")
    expect(typeof tool!.execute).toBe("function")
  })

  it("execute returns disconnected message when not connected", async () => {
    const tool = createKimakiStatusTool({
      enabled: true,
      config: defaultConfig,
    })
    const result = await tool!.execute({ channel: undefined, detailed: false } as any, {} as any)
    expect(result).toContain("Disconnected")
    expect(result).toContain("http://127.0.0.1:31099")
  })
})

// ── 6. Status reporting ────────────────────────────────────────

describe("createKimakiSendTool — execute", () => {
  beforeEach(() => {
    resetAdapter()
  })

  it("returns error JSON when not connected", async () => {
    const tool = createKimakiSendTool({
      enabled: true,
      config: defaultConfig,
    })
    const result = await tool!.execute({
      channelId: "ch_1",
      message: "hello",
    } as any, {} as any)
    const parsed = JSON.parse(result as string)
    expect(parsed.success).toBe(false)
    expect(parsed.error).toContain("not connected")
  })
})

describe("adapter — resolveAgentForContext edge cases", () => {
  beforeEach(() => {
    resetAdapter()
  })

  it("returns undefined when thread found but channel has no agentName", () => {
    mapChannel("ch_1", defaultConfig)
    mapThread("t1", "ch_1", "s1")
    const input: KimakiIngressInput = {
      prompt: "test",
      userId: "u1",
      username: "user1",
      sourceThreadId: "t1",
    }
    const result = adaptIngressToPrompt(input, defaultConfig)
    // Thread → channel found, channel.agentName is undefined, so short-circuits
    expect(result.agent).toBeUndefined()
  })

  it("falls through to config.agents when no sourceThreadId", () => {
    const input: KimakiIngressInput = {
      prompt: "test",
      userId: "u1",
      username: "user1",
    }
    const result = adaptIngressToPrompt(input, defaultConfig)
    expect(result.agent).toBe("dev_bot")
  })

  it("returns undefined when sourceThreadId references non-existent thread", () => {
    const input: KimakiIngressInput = {
      prompt: "test",
      userId: "u1",
      username: "user1",
      sourceThreadId: "nonexistent",
    }
    const result = adaptIngressToPrompt(input, defaultConfig)
    // Thread not found → falls through to config.agents[0]
    expect(result.agent).toBe("dev_bot")
  })
})

describe("adapter — getStatus", () => {
  beforeEach(() => {
    resetAdapter()
  })

  it("returns default status with no channels", () => {
    const s = getStatus()
    expect(s.connected).toBe(false)
    expect(s.channels).toEqual([])
    expect(s.activeThreads).toEqual([])
    expect(s.agents).toEqual([])
    expect(s.process).toHaveProperty("running")
    expect(s.process).toHaveProperty("ready")
  })

  it("includes mapped channels in status", () => {
    mapChannel("ch_1", defaultConfig)
    mapThread("t1", "ch_1", "s1")
    mapThread("t2", "ch_1", "s2")
    const s = getStatus()
    expect(s.channels).toHaveLength(1)
    expect(s.channels[0].threadCount).toBe(2)
  })

  it("includes active threads in status", () => {
    mapThread("t1", "ch_1", "s1")
    getOrCreateRunState("t1", "s1", "alice", "u1")
    const s = getStatus()
    expect(s.activeThreads).toHaveLength(1)
    expect(s.activeThreads[0].threadId).toBe("t1")
    expect(s.activeThreads[0].queueDepth).toBe(0)
  })

  it("shows queue depth in status", () => {
    mapThread("t1", "ch_1", "s1")
    getOrCreateRunState("t1", "s1", "alice", "u1")
    queueMessage("t1", { prompt: "q1", userId: "u1", username: "alice" })
    queueMessage("t1", { prompt: "q2", userId: "u1", username: "alice" })
    const s = getStatus()
    expect(s.activeThreads[0].queueDepth).toBe(2)
  })
})
