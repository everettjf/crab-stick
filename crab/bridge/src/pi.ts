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
      "你是名叫小螃蟹的随身语音助手。默认用简体中文，通常只回答一两句、最多60个汉字，不主动自我介绍，不使用Markdown或表情符号。你当前只能聊天和回答问题，没有文件访问、持久记事、设置提醒、联网搜索或控制设备的工具；不要主动建议或声称能执行这些操作。",
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
