"use strict";
(() => {
  let locale = "en";
  try {
    if (localStorage.getItem("crab-site.locale") === "zh") locale = "zh";
  } catch {}
  const labels = [...document.querySelectorAll("[data-zh]")].map((node) => ({
    node,
    en: node.textContent,
    zh: node.dataset.zh,
  }));
  function render() {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
    for (const { node, en, zh } of labels)
      node.textContent = (locale === "en" ? en : zh).replace(/\\n/g, "\n");
    const button = document.getElementById("locale");
    button.textContent = locale === "en" ? "中文" : "English";
    button.setAttribute(
      "aria-label",
      locale === "en" ? "Switch to Chinese" : "Switch to English",
    );
  }
  document.getElementById("locale").addEventListener("click", () => {
    locale = locale === "en" ? "zh" : "en";
    try {
      localStorage.setItem("crab-site.locale", locale);
    } catch {}
    render();
  });
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function select(tab) {
    for (const item of tabs) {
      const chosen = item === tab;
      item.setAttribute("aria-selected", String(chosen));
      item.tabIndex = chosen ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden =
        !chosen;
    }
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const at =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      select(tabs[at]);
      tabs[at].focus();
    });
  });
  select(tabs[0]);
  document.querySelectorAll(".copy").forEach((button) =>
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(
          button.parentElement.querySelector("code").textContent,
        );
        button.textContent = locale === "en" ? "Copied" : "已复制";
      } catch {
        button.textContent =
          locale === "en" ? "Select text to copy" : "请选择文本复制";
      }
      setTimeout(render, 1800);
    }),
  );
  render();
})();
