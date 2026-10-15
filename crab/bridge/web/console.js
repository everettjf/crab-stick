"use strict";
const $ = (id) => document.getElementById(id);
const t = (text) => window.CrabI18n.translate(text);
function setText(id, text) {
  $(id).dataset.uiText = text;
  $(id).textContent = t(text);
}
let token = "",
  stream,
  latest,
  dirty = false,
  initialized = false,
  choices = [],
  generation = 0,
  saving = false;
const stages = {
  upload: "上传录音",
  transcribing: "正在识别",
  thinking: "正在思考",
  synthesizing: "合成语音",
  sending: "发送语音",
  done: "回复已发送",
  error: "失败",
  cancelled: "已取消",
};
const modes = ["启动", "待机", "录音", "思考", "播放", "错误", "关闭", "开心"];
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = t(text);
  if (cls) n.className = cls;
  return n;
}
const clock = (t) =>
  new Date(t).toLocaleTimeString(
    window.CrabI18n.locale === "zh" ? "zh-CN" : "en-US",
    { hour12: false },
  );
async function api(path, options = {}) {
  const r = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    cache: "no-store",
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error("访问令牌无效，请重新连接");
    const text = await r.text();
    let message;
    try {
      message = JSON.parse(text).error;
    } catch {}
    throw new Error(message || `请求失败：${r.status}`);
  }
  return r;
}
function modelOptions() {
  const selected = $("model").value,
    options = [el("option", "Pi 默认模型")];
  options[0].value = "";
  for (const m of choices) {
    const o = el("option", `${t(m.name)} · ${m.provider}`);
    o.value = JSON.stringify([m.provider, m.id]);
    options.push(o);
  }
  $("model").replaceChildren(...options);
  $("model").value = selected;
}
function fillSettings(state) {
  const s = state.settings,
    value = s.provider ? JSON.stringify([s.provider, s.model]) : "";
  if (
    s.provider &&
    !choices.some((m) => m.provider === s.provider && m.id === s.model)
  ) {
    choices.push({
      provider: s.provider,
      id: s.model,
      name: `${s.model}（当前配置）`,
    });
    modelOptions();
  }
  $("model").value = value;
  $("stt-model").value = s.sttModel;
  $("language").value = s.language;
  $("tts-enabled").checked = s.ttsEnabled;
  $("voice").value = s.voice;
  $("rate").value = s.rate;
  setText("rate-value", s.rate);
  const a = state.audio;
  $("stt-model").disabled = !a.bundledStt;
  $("language").disabled = a.stt === "command" && !a.bundledStt;
  setText(
    "stt-note",
    a.bundledStt
      ? "首次使用新模型需要下载；大模型会增加内存占用与延迟。"
      : a.stt === "api"
        ? "当前使用语音 API，识别模型由电脑环境配置。"
        : "当前自定义命令的模型与语言由电脑端配置。",
  );
  $("voice").disabled =
    a.tts === "none" || (a.tts === "command" && !a.bundledTts);
  $("rate").disabled = !a.bundledTts;
  setText(
    "tts-note",
    a.bundledTts
      ? "填写已安装的 macOS 声音名，例如 Tingting。语速为每分钟词数。"
      : a.tts === "api"
        ? "声音名需由语音 API 支持；语速仅用于本地 macOS 适配器。"
        : "自定义语音命令在电脑端配置；关闭播放可仅返回文字。",
  );
}
function render(state) {
  latest = state;
  $("demo").hidden = !state.demo;
  setText("updated", `最近同步 ${clock(state.now)}`);
  const current = $("device-filter").value,
    options = [el("option", "所有设备")];
  options[0].value = "";
  for (const d of state.devices) {
    const o = el("option", d.id);
    o.value = d.id;
    options.push(o);
  }
  $("device-filter").replaceChildren(...options);
  $("device-filter").value = current;
  const devices = state.devices.map((d) => {
    const online = !!d.heartbeatAt && state.now - d.heartbeatAt < 35000,
      box = el("div", undefined, "device"),
      title = el("div", undefined, "device-title");
    title.append(
      el("strong", d.id),
      el(
        "span",
        online ? "● 在线" : d.heartbeatAt ? "○ 心跳已过期" : "○ 未启用心跳",
        online ? "online" : "offline",
      ),
    );
    box.append(title);
    const metrics = el("div", undefined, "metrics");
    const values = [
      [
        "电量",
        d.battery === undefined ? "—" : `${d.battery}%${d.usb ? " · USB" : ""}`,
      ],
      [
        "状态",
        d.processing ? "服务处理中" : online ? modes[d.mode] || "待机" : "未知",
      ],
      ["最近活动", clock(d.lastSeen)],
      [
        "运行时间",
        d.uptime_ms === undefined
          ? "—"
          : `${Math.floor(d.uptime_ms / 60000)} 分钟`,
      ],
    ];
    for (const [name, value] of values) {
      const item = el("span", name);
      item.append(el("b", value));
      metrics.append(item);
    }
    box.append(metrics);
    return box;
  });
  $("devices").replaceChildren(
    ...(devices.length
      ? devices
      : [el("p", "等待设备心跳或录音请求。", "empty")]),
  );
  const turns = state.turns
    .filter((t) => !current || t.device === current)
    .slice()
    .reverse()
    .map((t) => {
      const box = el("article", undefined, "turn"),
        meta = el("div", undefined, "turn-meta");
      meta.append(
        el("span", `${t.device} · ${clock(t.started)}`),
        el("span", stages[t.state] || t.state),
      );
      box.append(meta);
      const user = el("div", undefined, "bubble");
      user.append(
        el("span", "你", "role"),
        document.createTextNode(
          t.transcript || window.CrabI18n.translate("正在上传或识别…"),
        ),
      );
      box.append(user);
      if (t.reply) {
        const reply = el("div", undefined, "bubble assistant");
        reply.append(
          el("span", "小螃蟹", "role"),
          document.createTextNode(t.reply),
        );
        box.append(reply);
      }
      if (t.error) box.append(el("p", t.error, "error"));
      if (t.timing)
        box.append(
          el(
            "p",
            `识别 ${((t.timing.stt_ms || 0) / 1000).toFixed(1)}s · 收到录音至发送完成 ${((t.timing.total_ms || 0) / 1000).toFixed(1)}s`,
            "hint",
          ),
        );
      return box;
    });
  $("turns").replaceChildren(
    ...(turns.length
      ? turns
      : [
          el(
            "p",
            "按住 StickS3 正面按钮说话，松开后对话会出现在这里。",
            "empty",
          ),
        ]),
  );
  const level = $("log-filter").value,
    logs = state.logs
      .filter((l) => !level || l.level === level)
      .slice()
      .reverse()
      .map((l) => {
        const row = el("div", undefined, "log"),
          text = el("div", l.text);
        text.append(el("small", l.device));
        row.append(
          el("time", clock(l.at)),
          el(
            "span",
            { error: "错误", warning: "警告", info: "信息" }[l.level] ||
              l.level,
            l.level === "error" ? "error" : "",
          ),
          text,
        );
        return row;
      });
  $("logs").replaceChildren(
    ...(logs.length ? logs : [el("p", "暂无事件。", "empty")]),
  );
  if (!initialized || !dirty) {
    fillSettings(state);
    initialized = true;
  }
  $("save").disabled = saving || state.devices.some((d) => d.processing);
  if (!saving && $("save").disabled)
    setText("settings-result", "设备正在处理中，完成后可保存。");
  else if (
    $("settings-result").dataset.uiText === "设备正在处理中，完成后可保存。"
  )
    setText("settings-result", dirty ? "尚未保存" : "");
}
async function follow(myGeneration) {
  let delay = 1000;
  while (myGeneration === generation && token) {
    stream = new AbortController();
    try {
      const response = await api("/api/events", { signal: stream.signal });
      setText("connection", "● 实时连接");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let pending = "";
      let lastFrame = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastFrame > 30000) stream.abort();
      }, 5000);
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) throw new Error("连接已断开");
          if (myGeneration !== generation) {
            await reader.cancel();
            return;
          }
          lastFrame = Date.now();
          pending += decoder.decode(value, { stream: true });
          let index;
          while ((index = pending.indexOf("\n\n")) !== -1) {
            const frame = pending.slice(0, index);
            pending = pending.slice(index + 2);
            if (frame.startsWith("data: ")) render(JSON.parse(frame.slice(6)));
          }
          delay = 1000;
        }
      } finally {
        clearInterval(watchdog);
      }
    } catch (e) {
      if (myGeneration !== generation) return;
      setText("connection", `○ ${e.message}，正在重连`);
      if (e.message.includes("令牌")) {
        disconnect();
        setText("login-error", e.message);
        return;
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 10000);
    }
  }
}
function disconnect() {
  generation++;
  stream?.abort();
  token = "";
  latest = undefined;
  initialized = dirty = false;
  $("token").value = "";
  $("dashboard").hidden = true;
  $("login").hidden = false;
  $("logout").hidden = true;
  setText("connection", "尚未连接");
  for (const id of ["turns", "devices", "logs"]) $(id).replaceChildren();
}
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  setText("login-error", "");
  token = $("token").value.trim();
  try {
    const state = await (await api("/api/state")).json();
    choices = await (await api("/api/models")).json();
    modelOptions();
    $("token").value = "";
    $("login").hidden = true;
    $("dashboard").hidden = false;
    $("logout").hidden = false;
    render(state);
    void follow(++generation);
  } catch (error) {
    token = "";
    setText("login-error", error.message);
  } finally {
    button.disabled = false;
  }
});
$("logout").addEventListener("click", disconnect);
$("device-filter").addEventListener("change", () => latest && render(latest));
$("log-filter").addEventListener("change", () => latest && render(latest));
$("settings-form").addEventListener("input", () => {
  dirty = true;
  setText("rate-value", $("rate").value);
  setText("settings-result", "尚未保存");
});
$("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  saving = true;
  $("save").disabled = true;
  const [provider, model] = $("model").value
    ? JSON.parse($("model").value)
    : ["", ""];
  const settings = {
    provider,
    model,
    sttModel: $("stt-model").value,
    language: $("language").value,
    ttsEnabled: $("tts-enabled").checked,
    voice: $("voice").value.trim(),
    rate: Number($("rate").value),
  };
  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    dirty = false;
    setText("settings-result", "已保存，下一轮对话生效。");
    render(await (await api("/api/state")).json());
  } catch (error) {
    setText("settings-result", error.message);
  } finally {
    saving = false;
    $("save").disabled = latest?.devices.some((d) => d.processing) || false;
  }
});

$("locale-toggle").addEventListener("click", () => {
  window.CrabI18n.setLocale(window.CrabI18n.locale === "en" ? "zh" : "en");
  modelOptions();
  if (latest) render(latest);
});
