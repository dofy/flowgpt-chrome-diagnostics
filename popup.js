import { classifyFailure, failureTypes, requestAreas } from "./classification.js";
import { WINDOW_MS, captureProgress, ipAddress, makeReport, rayId, requestUrl, sessionKey, timeLeft } from "./diagnostics.js";
import { saveBundle, saveEvidence } from "./evidence.js";

const get = (id) => document.getElementById(id);
const failureSelect = get("failure");
const areaFilter = get("area-filter");
const failureFilter = get("failure-filter");
const selectionControls = document.querySelectorAll("[data-selection]");
const vpn = get("vpn");
const report = get("report");
const ipStatus = get("ip-status");
const panel = document.querySelector("main");
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const canStart = Boolean(requestUrl(tab?.url));
const key = Number.isInteger(tab?.id) ? sessionKey(tab.id) : "";
let session = key ? (await chrome.storage.session.get(key))[key] : undefined;
const emptyFailures = [];
let failure;
let manualSelection = "";
let classifiedSource;
let classified = [];
let visible = [];
let filterKey;
let ipKey = "";
let ip;
let pendingIp = false;
let exporting = false;
let fitTimer;

function fitToViewport() {
  clearTimeout(fitTimer);
  // Let Chrome resize the popup to its preferred height before applying a smaller screen limit.
  fitTimer = setTimeout(() => {
    if (document.documentElement.scrollHeight > innerHeight + 1) {
      panel.style.setProperty("--popup-limit", innerHeight + "px");
    }
  }, 80);
}

function tell(message) {
  get("feedback").hidden = !message;
  get("feedback").textContent = message;
}

function refreshReport() {
  if (!failure) {
    report.value = "";
    ipStatus.hidden = true;
    ipStatus.textContent = "";
    return;
  }
  const text = makeReport(failure, ip, vpn.value);
  if (report.value !== text) report.value = text;
  ipStatus.hidden = !pendingIp;
  ipStatus.textContent = pendingIp ? "Checking public IP…" : "";
  get("copy").disabled = pendingIp;
  const cannotCapture = pendingIp || exporting || !canStart;
  get("evidence").disabled = cannotCapture;
  get("bundle").disabled = cannotCapture;
}

async function getIp(item, owner) {
  if (item.type === "main_frame" && item.ray && owner.tabId === tab?.id) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: owner.tabId },
        func: () => {
          const footer = document.querySelector(".cf-error-footer, #cf-error-footer");
          const ip = footer?.querySelector("#cf-footer-ip")?.textContent;
          const ray = footer?.textContent.match(/Cloudflare Ray ID\s*:\s*([a-f0-9]{16}(?:-[a-z]{3})?)/i)?.[1];
          return { ip, ray };
        },
      });
      const exact = ipAddress(result?.ip);
      if (exact && rayId(result?.ray).slice(0, 16) === item.ray.slice(0, 16)) {
        return { value: exact, source: "Cloudflare error page for this Ray ID" };
      }
    } catch {
      // A navigation or browser-generated error page may prevent reading the footer.
    }
  }
  if (Date.now() - item.receivedAt > WINDOW_MS || owner.tabId !== tab?.id) return null;
  try {
    const endpoint = new URL("/cdn-cgi/trace", item.url);
    const response = await fetch(endpoint, {
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    const trace = await response.text();
    const measured = ipAddress(trace.match(/^ip=([a-f0-9:.]+)\s*$/im)?.[1]);
    return measured ? { value: measured, source: "Later check on " + endpoint.host + " at " + new Date().toISOString() } : null;
  } catch {
    return null;
  }
}

function updateIp() {
  const key = session && failure ? [session.id, failure.id, failure.ray].join("/") : "";
  if (key === ipKey) return;
  ipKey = key;
  ip = null;
  pendingIp = Boolean(key);
  if (!key) return;
  void getIp(failure, session).then((result) => {
    if (ipKey !== key) return;
    ip = result;
    pendingIp = false;
    refreshReport();
  });
}

function fillFilter(select, labels, field, allLabel) {
  const selected = select.value;
  const counts = new Map();
  for (const item of classified) counts.set(item[field], (counts.get(item[field]) ?? 0) + 1);
  select.replaceChildren(new Option(allLabel, ""));
  for (const [kind, label] of Object.entries(labels)) {
    const count = counts.get(kind) ?? 0;
    if (count || selected === kind) select.add(new Option(label + " (" + count + ")", kind));
  }
  select.value = selected;
}

function renderFailures(failures) {
  if (failures !== classifiedSource) {
    classifiedSource = failures;
    classified = failures.map((item) => ({ item, ...classifyFailure(item) }));
    fillFilter(areaFilter, requestAreas, "area", "All areas");
    fillFilter(failureFilter, failureTypes, "kind", "All failure types");
    filterKey = undefined;
  }
  const nextFilter = areaFilter.value + "/" + failureFilter.value;
  if (nextFilter !== filterKey) {
    filterKey = nextFilter;
    visible = classified.filter(({ area, kind }) => (!areaFilter.value || area === areaFilter.value)
      && (!failureFilter.value || kind === failureFilter.value));
    const options = document.createDocumentFragment();
    for (const { item, area, kind } of visible) {
      const url = new URL(item.url);
      const when = new Date(item.at).toLocaleTimeString("en-GB");
      const label = [requestAreas[area], failureTypes[kind], when, url.host + url.pathname].join(" · ");
      options.append(new Option(label, item.id));
    }
    failureSelect.replaceChildren(options);
  }
  failure = visible.find(({ item }) => item.id === manualSelection)?.item ?? visible[0]?.item;
  if (failure) failureSelect.value = failure.id;
  get("filter-count").textContent = visible.length + " of " + failures.length;
  get("picker").hidden = visible.length < 2;
  get("no-matches").hidden = Boolean(visible.length) || !failures.length;
  for (const control of selectionControls) control.hidden = !failure;
}

function render() {
  const status = captureProgress(session);
  const { active } = status;
  const failures = session?.failures ?? emptyFailures;
  get("instructions").hidden = active || Boolean(failures.length);
  get("start").hidden = active;
  get("start").disabled = !canStart;
  get("start").textContent = session ? "Record again" : "Start recording";
  get("stop").hidden = !active;
  get("clear").hidden = !session || active;
  get("retention").hidden = Boolean(failures.length);
  get("footer").hidden = active && Boolean(failures.length);
  get("capture-status").dataset.phase = status.phase;
  if (get("capture-phase").textContent !== status.label) get("capture-phase").textContent = status.label;
  get("countdown").hidden = !active;
  if (active) get("countdown").textContent = timeLeft(status.endsAt) + " left";
  get("recording").hidden = !status.detail;
  get("recording").textContent = status.detail;
  get("results").hidden = !failures.length;
  const captureHint = canStart ? "" : "Return to a FlowGPT or Emochi page in this tab to take a screenshot.";
  get("evidence").title = captureHint;
  get("bundle").title = captureHint;
  renderFailures(failures);
  updateIp();
  refreshReport();
}

async function send(action) {
  tell("");
  try {
    const response = await chrome.runtime.sendMessage({ action, tabId: tab?.id });
    if (!response?.ok) throw new Error(response?.error || "Try opening this extension again.");
    if (action === "start") window.close();
  } catch (error) {
    tell(error.message);
  }
}

for (const action of ["start", "stop", "clear"]) {
  get(action).addEventListener("click", () => send(action));
}
failureSelect.addEventListener("change", () => {
  manualSelection = failureSelect.value;
  tell("");
  render();
});
for (const filter of [areaFilter, failureFilter]) {
  filter.addEventListener("change", () => {
    manualSelection = "";
    tell("");
    render();
  });
}
vpn.addEventListener("change", refreshReport);
get("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(report.value);
    tell("Report copied.");
  } catch {
    report.focus();
    report.select();
    tell("Report selected. Press Ctrl+C or Command+C to copy.");
  }
});
async function exportReport(bundle) {
  if (exporting) return;
  exporting = true;
  refreshReport();
  tell("");
  try {
    if (bundle) {
      await saveBundle(session, failure, report.value, vpn.value);
    } else {
      await saveEvidence(session.tabId, report.value);
    }
    tell(bundle ? "Diagnostic ZIP saved." : "Evidence image saved.");
  } catch (error) {
    tell(error.message || "Copy the report and attach a screenshot taken on your device.");
  } finally {
    exporting = false;
    refreshReport();
  }
}
get("evidence").addEventListener("click", () => exportReport(false));
get("bundle").addEventListener("click", () => exportReport(true));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes[key]) return;
  const previousId = session?.id;
  session = changes[key].newValue;
  if (session?.id !== previousId) {
    manualSelection = "";
    areaFilter.value = "";
    failureFilter.value = "";
    get("filters").open = false;
    vpn.selectedIndex = 0;
  }
  render();
});
setInterval(render, 1000);
new ResizeObserver(fitToViewport).observe(panel);
window.addEventListener("resize", fitToViewport);
render();
