import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const source = await readFile(
  new URL("../web/i18n.js", import.meta.url),
  "utf8",
);
function setup(saved?: string, blocked = false) {
  const storage = new Map(saved ? [["crab.locale", saved]] : []);
  const texts = [
    { textContent: "  Live\n conversations  " },
    { textContent: "Next-turn settings" },
  ];
  const toggle = {
    textContent: "",
    setAttribute(_key: string, _value: string) {},
  };
  const placeholder = {
    attributes: new Map([["placeholder", "e.g. Tingting"]]),
    getAttribute(k: string) {
      return this.attributes.get(k);
    },
    setAttribute(k: string, v: string) {
      this.attributes.set(k, v);
    },
  };
  const dynamic = {
    dataset: { uiText: "已保存，下一轮对话生效。" },
    textContent: "",
  };
  const document = {
    body: {},
    title: "",
    documentElement: { lang: "" },
    createTreeWalker() {
      let index = -1;
      return {
        currentNode: texts[0],
        nextNode() {
          index++;
          this.currentNode = texts[index];
          return index < texts.length;
        },
      };
    },
    querySelectorAll(selector: string) {
      return selector === "[data-ui-text]" ? [dynamic] : [placeholder];
    },
    getElementById() {
      return toggle;
    },
  };
  const context: any = {
    window: {},
    document,
    NodeFilter: { SHOW_TEXT: 4 },
    localStorage: {
      getItem(k: string) {
        if (blocked) throw new Error("disabled");
        return storage.get(k);
      },
      setItem(k: string, v: string) {
        if (blocked) throw new Error("disabled");
        storage.set(k, v);
      },
    },
  };
  runInNewContext(source, context);
  return {
    i18n: context.window.CrabI18n,
    document,
    texts,
    placeholder,
    dynamic,
    toggle,
    storage,
  };
}
test("console defaults to English and translates statuses, numbers and parameterized errors", () => {
  const a = setup();
  assert.equal(a.document.documentElement.lang, "en");
  assert.equal(a.toggle.textContent, "中文");
  assert.equal(a.i18n.translate("● 在线"), "● Online");
  assert.equal(a.i18n.translate(210), "210");
  assert.equal(a.i18n.translate("最近同步 12:34:56"), "Updated 12:34:56");
  assert.equal(
    a.i18n.translate("识别 2.0s · 收到录音至发送完成 5.0s"),
    "STT 2.0s · Recording received to reply sent 5.0s",
  );
  assert.equal(
    a.i18n.translate("○ 连接已断开，正在重连"),
    "○ Connection lost · Reconnecting",
  );
  assert.equal(
    a.i18n.translate("用户原始对话，不应翻译"),
    "用户原始对话，不应翻译",
  );
});
test("language switches static labels, dynamic notices and placeholders, and survives reload", () => {
  const a = setup();
  a.i18n.setLocale("zh");
  assert.equal(a.texts[0].textContent.trim(), "实时对话");
  assert.equal(a.placeholder.attributes.get("placeholder"), "例如 Tingting");
  assert.equal(a.dynamic.textContent, "已保存，下一轮对话生效。");
  assert.equal(a.document.title, "Crab · 设备控制台");
  assert.equal(a.toggle.textContent, "English");
  assert.equal(
    setup(a.storage.get("crab.locale")).document.documentElement.lang,
    "zh-CN",
  );
  a.i18n.setLocale("en");
  assert.equal(a.texts[0].textContent, "  Live conversations  ");
  assert.equal(a.dynamic.textContent, "Saved. Applies to the next turn.");
});
test("language selection works when local storage is unavailable and ignores invalid saved values", () => {
  const a = setup(undefined, true);
  assert.equal(a.i18n.locale, "en");
  assert.doesNotThrow(() => a.i18n.setLocale("zh"));
  assert.equal(a.i18n.locale, "zh");
  assert.equal(setup("invalid").i18n.locale, "en");
});
