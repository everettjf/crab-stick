"use strict";
(() => {
  const messages = {
    "Crab · 设备控制台": "Crab · Device console",
    "随身助手 / 本地控制台": "Pocket companion / Local console",
    尚未连接: "Not connected",
    断开: "Disconnect",
    "看看小螃蟹在忙什么。": "See what your Crab is up to.",
    "连接电脑桥接服务，查看设备、实时对话与错误，调整下一轮对话的设置。":
      "Connect to your bridge to monitor devices, follow conversations and errors, and tune the next turn.",
    "共享访问令牌 CRAB_TOKEN": "Shared access token · CRAB_TOKEN",
    "填写本机 bridge/.env 中的 CRAB_TOKEN":
      "Enter CRAB_TOKEN from your local bridge/.env",
    连接控制台: "Connect",
    "令牌只保存在当前页面内存中。刷新后需重新连接。":
      "Your token stays in page memory. Reconnect after refreshing.",
    小螃蟹的工作台: "Your Crab workspace",
    "设备在手边，对话在这里。": "Your device nearby. Your conversations here.",
    设备状态: "Devices",
    "10 秒心跳": "10s heartbeat",
    "等待设备上报。旧固件仅在发送录音后显示最近活动。":
      "Waiting for a device. Older firmware only reports activity when sending a recording.",
    实时对话: "Live conversations",
    筛选对话设备: "Filter conversations by device",
    所有设备: "All devices",
    "显示此服务进程最近 100 轮对话；录音保存以电脑端配置为准。音频发送完成不代表设备已经播放完毕。":
      "The last 100 turns in this session. Recording retention follows the bridge configuration. Audio sent does not mean playback is complete.",
    "按住 StickS3 正面按钮说话，松开后对话会出现在这里。":
      "Hold the front button on your StickS3 to speak. Release it to see the conversation here.",
    事件与错误: "Events & errors",
    筛选日志: "Filter logs",
    全部级别: "All levels",
    错误: "Error",
    警告: "Warning",
    信息: "Info",
    "暂无事件。": "No events yet.",
    下一轮设置: "Next-turn settings",
    本机保存: "Saved locally",
    对话模型: "Conversation model",
    "Pi 默认模型": "Pi default model",
    "只列出已配置凭据的 Pi 模型。切换模型会清空设备对话上下文。":
      "Pi models with configured credentials. Switching models clears device conversation context.",
    语音识别: "Speech recognition",
    "本地 Whisper 模型": "Local Whisper model",
    识别语言: "Recognition language",
    中文: "Chinese",
    语音回复: "Voice replies",
    播放语音回复: "Enable voice replies",
    声音名称: "Voice name",
    "例如 Tingting": "e.g. Tingting",
    本地语速: "Local speech rate",
    保存设置: "Save settings",
    "电脑需保持唤醒。状态和对话仅在本次服务运行期间保留，模型与语音设置会保存在本机。":
      "Keep your computer awake. Device and conversation history live in this process; model and speech settings are saved locally.",
    "自己的设备，自己的模型。": "Your device. Your models.",
    上传录音: "Uploading",
    正在识别: "Transcribing",
    正在思考: "Thinking",
    合成语音: "Synthesizing speech",
    发送语音: "Sending audio",
    回复已发送: "Reply sent",
    失败: "Failed",
    已取消: "Cancelled",
    启动: "Starting",
    待机: "Idle",
    录音: "Recording",
    思考: "Thinking",
    播放: "Playing",
    关闭: "Off",
    开心: "Happy",
    "访问令牌无效，请重新连接": "Invalid access token. Please reconnect.",
    "请求失败：{0}": "Request failed: {0}",
    "{0}（当前配置）": "{0} (current configuration)",
    "首次使用新模型需要下载；大模型会增加内存占用与延迟。":
      "New models download on first use. Larger models need more memory and time.",
    "当前使用语音 API，识别模型由电脑环境配置。":
      "Using a speech API. The recognition model is configured on the computer.",
    "当前自定义命令的模型与语言由电脑端配置。":
      "The model and language for your custom command are configured on the computer.",
    "填写已安装的 macOS 声音名，例如 Tingting。语速为每分钟词数。":
      "Use an installed macOS voice, such as Tingting. Rate is in words per minute.",
    "声音名需由语音 API 支持；语速仅用于本地 macOS 适配器。":
      "Use a voice supported by your speech API. Rate applies only to the local macOS adapter.",
    "自定义语音命令在电脑端配置；关闭播放可仅返回文字。":
      "Custom speech commands are configured on the computer. Disable voice replies for text only.",
    "最近同步 {0}": "Updated {0}",
    "● 在线": "● Online",
    "○ 心跳已过期": "○ Heartbeat expired",
    "○ 未启用心跳": "○ No heartbeat",
    电量: "Battery",
    状态: "Status",
    服务处理中: "Processing",
    未知: "Unknown",
    最近活动: "Last activity",
    运行时间: "Uptime",
    "{0} 分钟": "{0} min",
    "等待设备心跳或录音请求。": "Waiting for a heartbeat or recording.",
    你: "You",
    "正在上传或识别…": "Uploading or transcribing…",
    小螃蟹: "Crab",
    "识别 {0}s · 收到录音至发送完成 {1}s":
      "STT {0}s · Recording received to reply sent {1}s",
    "设备正在处理中，完成后可保存。":
      "A device is processing. Save when it finishes.",
    尚未保存: "Unsaved changes",
    "● 实时连接": "● Live",
    连接已断开: "Connection lost",
    "○ {0}，正在重连": "○ {0} · Reconnecting",
    "已保存，下一轮对话生效。": "Saved. Applies to the next turn.",
    "设置已保存，将用于下一轮对话；模型切换会清空对话上下文":
      "Settings saved for the next turn. Switching models clears conversation context.",
    "设备正在处理中，请稍后保存设置":
      "A device is processing. Try saving again when it finishes.",
    "模型不可用，请先在电脑端配置 Pi 凭据与 models.json":
      "Model unavailable. Configure Pi credentials and models.json on the computer.",
    设置格式无效: "Invalid settings format",
    设置字段无效: "Invalid settings fields",
    请选择完整的模型与服务商: "Select both a provider and a model",
    识别模型或语言无效: "Invalid recognition model or language",
    "语音设置无效：语速应为 80–350":
      "Invalid speech settings: rate must be 80–350",
    "没有听清，请靠近麦克风再说一次":
      "No speech recognized. Move closer to the microphone and try again.",
    "模型或语音服务认证失败，请检查电脑端配置":
      "Model or speech service authentication failed. Check the bridge configuration.",
    "已取消或处理超时，请重试": "Cancelled or timed out. Please try again.",
    "录音超过 20 秒限制": "Recording exceeds the 20-second limit",
    控制台连接数已满: "Console connection limit reached",
    接口不存在: "Endpoint not found",
    请求内容过大: "Request body too large",
    控制台请求失败: "Console request failed",
    "对话失败，请重试": "Turn failed. Please try again.",
  };
  const reverse = new Map(Object.entries(messages).map(([zh, en]) => [en, zh]));
  const patterns = Object.entries(messages)
    .filter(([key]) => /\{\d+\}/.test(key))
    .map(([key, value]) => {
      const parts = key.split(/(\{\d+\})/);
      const expression = parts
        .map((p) =>
          /^\{\d+\}$/.test(p)
            ? "(.*?)"
            : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("");
      return { regex: new RegExp("^" + expression + "$"), value };
    });
  let locale = "en";
  try {
    if (localStorage.getItem("crab.locale") === "zh") locale = "zh";
  } catch {}
  function translate(text) {
    text = String(text ?? "");
    if (locale === "zh") return text;
    if (messages[text]) return messages[text];
    for (const { regex, value } of patterns) {
      const match = regex.exec(text);
      if (match)
        return value.replace(/\{(\d+)\}/g, (_, n) =>
          translate(match[Number(n) + 1]),
        );
    }
    const prefix = "语音合成失败，仅显示文字：";
    if (text.startsWith(prefix))
      return (
        "Speech synthesis failed; text only: " +
        translate(text.slice(prefix.length))
      );
    return text;
  }
  const bindings = [];
  function bind() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const raw = node.textContent;
      const text = raw.trim().replace(/\s+/g, " ");
      if (text === "Crab" && node.parentElement?.closest(".brand")) continue;
      const source = reverse.get(text) || text;
      if (messages[source]) {
        const leading = raw.match(/^\s*/)[0],
          trailing = raw.match(/\s*$/)[0];
        bindings.push(() => {
          node.textContent = leading + translate(source) + trailing;
        });
      }
    }
    for (const node of document.querySelectorAll(
      "[placeholder],[aria-label]",
    )) {
      for (const key of ["placeholder", "aria-label"]) {
        const text = node.getAttribute(key);
        if (!text) continue;
        const source = reverse.get(text) || text;
        if (messages[source])
          bindings.push(() => node.setAttribute(key, translate(source)));
      }
    }
  }
  function refresh() {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = translate("Crab · 设备控制台");
    bindings.forEach((update) => update());
    for (const node of document.querySelectorAll("[data-ui-text]"))
      node.textContent = translate(node.dataset.uiText);
    const toggle = document.getElementById("locale-toggle");
    toggle.textContent = locale === "en" ? "中文" : "English";
    toggle.setAttribute(
      "aria-label",
      locale === "en" ? "Switch to Chinese" : "切换英文",
    );
  }
  window.CrabI18n = {
    translate,
    refresh,
    get locale() {
      return locale;
    },
    setLocale(value) {
      locale = value === "zh" ? "zh" : "en";
      try {
        localStorage.setItem("crab.locale", locale);
      } catch {}
      refresh();
    },
  };
  bind();
  refresh();
})();
