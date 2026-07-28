export type CommandType = "sync_media";

export type CommandStatus = "queued" | "dispatched" | "completed" | "failed";

export interface AgentState {
  agentId: string;
  label: string;
  platform: string;
  version: string;
  lastSeenAt: string;
  status: "online" | "offline";
}

export interface DeviceState {
  deviceId: string;
  label: string;
  kind: string;
  userAgent: string;
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
  devices: Map<string, DeviceState>;
}

declare global {
  var nativeControlPlaneStore: ControlPlaneStore | undefined;
}

const store =
  globalThis.nativeControlPlaneStore ??
  (globalThis.nativeControlPlaneStore = {
    agents: new Map<string, AgentState>(),
    commands: new Map<string, CommandState[]>(),
    devices: new Map<string, DeviceState>(),
  });

// devices only exist while a phone/browser tab is open and heartbeating, so
// they use a shorter window than the host agent's 45s poll interval.
const OFFLINE_THRESHOLD_MS = 45_000;
const DEVICE_OFFLINE_THRESHOLD_MS = 30_000;

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

function updateDeviceStatus(device: DeviceState): DeviceState {
  const lastSeenMs = new Date(device.lastSeenAt).getTime();
  const online = Date.now() - lastSeenMs < DEVICE_OFFLINE_THRESHOLD_MS;
  return {
    ...device,
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

export function renameAgent(agentId: string, label: string): AgentState | null {
  const agent = store.agents.get(agentId);
  if (!agent) {
    return null;
  }

  const updated = updateAgentStatus({ ...agent, label });
  store.agents.set(agentId, updated);
  return updated;
}

export function removeAgent(agentId: string): boolean {
  const existed = store.agents.delete(agentId);
  store.commands.delete(agentId);
  return existed;
}

export function registerDevice(input: {
  deviceId: string;
  label: string;
  kind: string;
  userAgent: string;
}): DeviceState {
  const current = store.devices.get(input.deviceId);
  const next: DeviceState = updateDeviceStatus({
    deviceId: input.deviceId,
    label: input.label || current?.label || "Device",
    kind: input.kind || current?.kind || "unknown",
    userAgent: input.userAgent || current?.userAgent || "",
    lastSeenAt: nowIso(),
    status: "online",
  });

  store.devices.set(input.deviceId, next);
  return next;
}

export function heartbeatDevice(deviceId: string): DeviceState | null {
  const device = store.devices.get(deviceId);
  if (!device) {
    return null;
  }

  const updated = updateDeviceStatus({ ...device, lastSeenAt: nowIso() });
  store.devices.set(deviceId, updated);
  return updated;
}

export function renameDevice(deviceId: string, label: string): DeviceState | null {
  const device = store.devices.get(deviceId);
  if (!device) {
    return null;
  }

  const updated = updateDeviceStatus({ ...device, label });
  store.devices.set(deviceId, updated);
  return updated;
}

export function removeDevice(deviceId: string): boolean {
  return store.devices.delete(deviceId);
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
  const devices = Array.from(store.devices.values()).map(updateDeviceStatus);

  return {
    generatedAt: nowIso(),
    agents: agents.sort((a, b) => a.agentId.localeCompare(b.agentId)),
    commands: commands.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    devices: devices.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
  };
}

export function seedDemoAgentIfEmpty() {
  if (store.agents.size > 0) {
    return;
  }

  upsertAgent({
    agentId: "host-main",
    label: "Main Host",
    platform: "windows",
    version: "0.1.0",
  });
}