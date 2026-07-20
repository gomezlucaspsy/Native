export type CommandType =
  | "scan_devices"
  | "start_hotspot"
  | "stop_hotspot"
  | "sync_media";

export type CommandStatus = "queued" | "dispatched" | "completed" | "failed";

export interface AgentState {
  agentId: string;
  label: string;
  platform: string;
  version: string;
  lastSeenAt: string;
  status: "online" | "offline";
}

export interface CommandState {
  id: string;
  agentId: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  createdAt: string;
  updatedAt: string;
  result?: string;
}

interface ControlPlaneStore {
  agents: Map<string, AgentState>;
  commands: Map<string, CommandState[]>;
}

declare global {
  var nativeControlPlaneStore: ControlPlaneStore | undefined;
}

const store =
  globalThis.nativeControlPlaneStore ??
  (globalThis.nativeControlPlaneStore = {
    agents: new Map<string, AgentState>(),
    commands: new Map<string, CommandState[]>(),
  });

const OFFLINE_THRESHOLD_MS = 45_000;

function nowIso(): string {
  return new Date().toISOString();
}

function updateAgentStatus(agent: AgentState): AgentState {
  const lastSeenMs = new Date(agent.lastSeenAt).getTime();
  const online = Date.now() - lastSeenMs < OFFLINE_THRESHOLD_MS;
  return {
    ...agent,
    status: online ? "online" : "offline",
  };
}

export function upsertAgent(input: {
  agentId: string;
  label: string;
  platform: string;
  version: string;
}): AgentState {
  const current = store.agents.get(input.agentId);
  const next: AgentState = updateAgentStatus({
    agentId: input.agentId,
    label: input.label || current?.label || input.agentId,
    platform: input.platform || current?.platform || "unknown",
    version: input.version || current?.version || "0.0.0",
    lastSeenAt: nowIso(),
    status: "online",
  });

  store.agents.set(input.agentId, next);

  if (!store.commands.has(input.agentId)) {
    store.commands.set(input.agentId, []);
  }

  return next;
}

export function heartbeatAgent(agentId: string): AgentState | null {
  const agent = store.agents.get(agentId);
  if (!agent) {
    return null;
  }

  const updated: AgentState = updateAgentStatus({
    ...agent,
    lastSeenAt: nowIso(),
  });

  store.agents.set(agentId, updated);
  return updated;
}

export function enqueueCommand(input: {
  agentId: string;
  type: CommandType;
  payload?: Record<string, unknown>;
}): CommandState {
  const queue = store.commands.get(input.agentId) ?? [];
  const timestamp = nowIso();

  const command: CommandState = {
    id: `${input.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId: input.agentId,
    type: input.type,
    payload: input.payload ?? {},
    status: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  queue.push(command);
  store.commands.set(input.agentId, queue);
  return command;
}

export function dispatchPendingCommands(agentId: string): CommandState[] {
  const queue = store.commands.get(agentId) ?? [];
  const timestamp = nowIso();
  const toDispatch: CommandState[] = [];

  for (const command of queue) {
    if (command.status === "queued") {
      command.status = "dispatched";
      command.updatedAt = timestamp;
      toDispatch.push({ ...command });
    }
  }

  return toDispatch;
}

export function completeCommand(input: {
  agentId: string;
  commandId: string;
  success: boolean;
  result?: string;
}): CommandState | null {
  const queue = store.commands.get(input.agentId) ?? [];
  const command = queue.find((item) => item.id === input.commandId);

  if (!command) {
    return null;
  }

  command.status = input.success ? "completed" : "failed";
  command.result = input.result;
  command.updatedAt = nowIso();
  return { ...command };
}

export function snapshotState() {
  const agents = Array.from(store.agents.values()).map(updateAgentStatus);
  const commands = Array.from(store.commands.values()).flat();

  return {
    generatedAt: nowIso(),
    agents: agents.sort((a, b) => a.agentId.localeCompare(b.agentId)),
    commands: commands.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export function seedDemoAgentIfEmpty() {
  if (store.agents.size > 0) {
    return;
  }

  const demo = upsertAgent({
    agentId: "host-main",
    label: "Main Host",
    platform: "windows",
    version: "0.1.0",
  });

  enqueueCommand({
    agentId: demo.agentId,
    type: "scan_devices",
    payload: { reason: "bootstrap" },
  });
}