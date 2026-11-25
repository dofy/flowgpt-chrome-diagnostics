(() => {
  if (globalThis.flowgptDiagnosticsPanelLoaded) return;
  globalThis.flowgptDiagnosticsPanelLoaded = true;

  const host = document.createElement("flowgpt-diagnostics-progress");
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "open" });
  const styles = new CSSStyleSheet();
  styles.replaceSync([
    ":host { all: initial; display: block; position: fixed; right: 14px; bottom: 14px; width: min(305px, calc(100vw - 28px));",
    "  z-index: 2147483647; color: #16372e; pointer-events: none; color-scheme: light; }",
    ":host([hidden]), [hidden] { display: none !important; }",
    ".card { box-sizing: border-box; padding: 11px 12px; border: 1px solid #adc8ba; border-radius: 10px;",
    "  background: #f7fbf9; box-shadow: 0 4px 16px #183d3030; font: 13px/1.4 system-ui, sans-serif; pointer-events: auto; }",
    ".top, .phase { display: flex; align-items: center; gap: 7px; }",
    ".top { justify-content: space-between; color: #426058; margin-bottom: 4px; }",
    ".phase { color: #185b47; font-weight: 700; }",
    ".phase[data-phase=detected] { color: #934019; }",
    ".phase::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: 0 0 7px; }",
    ".time { margin-left: auto; color: #426058; font-weight: 500; font-variant-numeric: tabular-nums; }",
    "p { margin: 4px 0 0; }",
    "button { min-height: 25px; padding: 2px 6px; background: #eaf3ee; color: #185b47;",
    "  border: 1px solid #c0d4c9; border-radius: 5px; font: inherit; cursor: pointer; }",
    "button:hover { background: #ddeee4; } button:focus-visible { outline: 2px solid #297f65; outline-offset: 2px; }",
  ].join("\n"));
  shadow.adoptedStyleSheets = [styles];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  const card = element("aside", "card");
  card.setAttribute("aria-label", "FlowGPT diagnostics progress");
  const top = element("div", "top");
  const hide = element("button", "", "Hide");
  hide.type = "button";
  hide.setAttribute("aria-label", "Hide diagnostics progress");
  top.append(element("span", "", "FlowGPT diagnostics"), hide);
  const phase = element("div", "phase");
  const label = element("span");
  label.setAttribute("role", "status");
  const time = element("span", "time");
  time.setAttribute("aria-hidden", "true");
  phase.append(label, time);
  const detail = element("p");
  card.append(top, phase, detail);
  shadow.append(card);

  let panel;
  let suspended = false;
  let resumeTimer;
  let ticker;

  function render() {
    host.hidden = !panel || suspended;
    if (!panel) return;
    if (!host.isConnected) document.documentElement.append(host);
    const remaining = Math.max(0, Math.ceil((panel.current.endsAt - Date.now()) / 1000));
    const status = remaining === 0 ? panel.finished : panel.current;
    if (!status.active && ticker) {
      clearInterval(ticker);
      ticker = undefined;
    }
    phase.dataset.phase = status.phase;
    if (label.textContent !== status.label) label.textContent = status.label;
    time.hidden = !status.active;
    time.textContent = Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0") + " left";
    detail.textContent = status.detail + (status.count ? " Open the extension for the report." : "");
  }

  hide.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ action: "hide-progress" }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === "capture-progress") {
      panel = message.panel;
      clearInterval(ticker);
      ticker = panel?.current.active ? setInterval(render, 1000) : undefined;
      render();
      respond(true);
      return false;
    }
    if (message?.type === "suspend-progress") {
      clearTimeout(resumeTimer);
      suspended = message.hidden;
      render();
      if (suspended && panel) {
        resumeTimer = setTimeout(() => {
          suspended = false;
          render();
        }, 5000);
        const fallback = setTimeout(() => respond(true), 150);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          clearTimeout(fallback);
          respond(true);
        }));
        return true;
      }
      respond(true);
    }
    return false;
  });
})();
