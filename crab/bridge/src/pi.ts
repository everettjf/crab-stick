import {
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
  SettingsManager,
  getAgentDir,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

export interface Agent {
  reply(
    text: string,
    delta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string>;
  dispose(): void;
}
export async function createPiAgent(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Agent> {
  // Dedicated workspace: no project extensions, skills, context files or default shell/file tools.
  const agentDir = env.PI_AGENT_DIR || getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    systemPromptOverride: () =>
      "你是一只叫 Crab 的随身螃蟹助手。默认用简体中文，回答简短清楚，适合小屏幕和语音，通常不超过150字。不要假装执行了没有工具支持的操作。",
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    noTools: "all",
    settingsManager,
    sessionManager: SessionManager.inMemory(),
  });
  if (env.PI_PROVIDER || env.PI_MODEL) {
    if (!env.PI_PROVIDER || !env.PI_MODEL) {
      session.dispose();
      throw new Error("Set both PI_PROVIDER and PI_MODEL");
    }
    const model = session.modelRuntime.getModel(env.PI_PROVIDER, env.PI_MODEL);
    if (!model) {
      session.dispose();
      throw new Error("Configured Pi model not found");
    }
    await session.setModel(model);
  }
  return new PiAgent(session);
}
class PiAgent implements Agent {
  constructor(private session: AgentSession) {}
  async reply(
    text: string,
    delta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const unsubscribe = this.session.subscribe((e) => {
      if (
        e.type === "message_update" &&
        e.assistantMessageEvent.type === "text_delta"
      )
        delta(e.assistantMessageEvent.delta);
    });
    const abort = () => {
      void this.session.abort();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await this.session.prompt(text);
      signal.throwIfAborted();
      const last = [...this.session.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (
        last?.role === "assistant" &&
        (last.stopReason === "error" || last.stopReason === "aborted")
      )
        throw new Error(last.errorMessage || "Pi generation failed");
      const textOut = this.session.getLastAssistantText();
      if (!textOut) throw new Error("Pi returned no reply");
      return textOut;
    } finally {
      unsubscribe();
      signal.removeEventListener("abort", abort);
    }
  }
  dispose() {
    this.session.dispose();
  }
}
