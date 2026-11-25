import { failurePriority } from "./classification.js";
import { WINDOW_MS, HOSTS, captureProgress, failureFrom, isRecording, rayId, requestUrl, sessionKey } from "./diagnostics.js";

const networkFilter = { urls: HOSTS.map((host) => "https://*." + host + "/*") };
const alarmPrefix = "recording-deadline:";
const updates = new Map();

function update(tabId, task) {
  // Keep writes to the same tab ordered without blocking other tabs.
  const result = (updates.get(tabId) ?? Promise.resolve()).then(task);
  const settled = result.catch(() => {});
  updates.set(tabId, settled);
  void settled.then(() => {
    if (updates.get(tabId) === settled) updates.delete(tabId);
  });
  return result;
}

async function readSession(tabId) {
  const key = sessionKey(tabId);
  return (await chrome.storage.session.get(key))[key];
}

function save(session) {
  return chrome.storage.session.set({ [sessionKey(session.tabId)]: session });
}

async function clearSession(tabId) {
  await chrome.storage.session.remove(sessionKey(tabId));
  await chrome.alarms.clear(alarmPrefix + tabId);
}

function withFailure(session, failure) {
  const failures = [failure, ...session.failures.filter((item) => item.id !== failure.id)];
  failures.sort((a, b) => b.priority - a.priority || b.at - a.at);
  return { ...session, failures };
}

async function identifyBlockPage(tabId, pageUrl, session) {
  const url = requestUrl(pageUrl);
  const candidates = session.failures.filter((item) => item.type === "main_frame"
    && item.status === 403 && !item.challenge && !item.blockPage && item.ray && item.url === url?.href);
  if (!candidates.length) return session;
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const footer = document.querySelector(".cf-error-footer, #cf-error-footer");
      const heading = document.querySelector("#cf-error-details h1, .cf-error-overview h1, h1");
      if (!footer || !/^(?:sorry,\s*)?you have been blocked[.!]?$/i.test(heading?.textContent.trim())) return null;
      const ray = footer.textContent.match(/Cloudflare Ray ID\s*:\s*([a-f0-9]{16}(?:-[a-z]{3})?)/i)?.[1];
      return { url: location.href, ray };
    },
  }).catch(() => []);
  const page = results[0]?.result;
  if (!page || requestUrl(page.url)?.href !== url.href) return session;
  const ray = rayId(page.ray).slice(0, 16);
  const failure = candidates.find((item) => item.ray.slice(0, 16) === ray);
  if (!failure) return session;
  const confirmed = { ...failure, blockPage: true };
  const next = withFailure(session, { ...confirmed, priority: failurePriority(confirmed) });
  await save(next);
  return next;
}

async function publishProgress(tabId, session, inject = false) {
  const current = captureProgress(session);
  const badge = {
    recording: ["REC", "#185b47"],
    detected: ["ERR", "#9b411c"],
    ready: ["RPT", "#185b47"],
  }[current.phase];
  const panel = session && !session.panelHidden
    ? { current, finished: captureProgress(session, session.endsAt) }
    : null;
  const message = { type: "capture-progress", panel };
  const deliver = async () => {
    try {
      await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    } catch {
      if (!panel || !inject || !requestUrl((await chrome.tabs.get(tabId)).url)) return;
      await chrome.scripting.executeScript({ target: { tabId }, files: ["progress-panel.js"] });
      await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    }
  };
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: badge?.[0] ?? "" }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: badge?.[1] ?? "#185b47" }),
    chrome.action.setTitle({ tabId, title: "FlowGPT Diagnostics · " + current.label }),
    deliver(),
  ]);
}

function record(details) {
  const { tabId } = details;
  if (tabId < 0) return;
  const failure = failureFrom(details);
  if (!failure) return;
  const receivedAt = Date.now();
  void update(tabId, async () => {
    const session = await readSession(tabId);
    if (!isRecording(session, receivedAt) || receivedAt < session.startedAt) return;
    const previous = session.failures.find((item) => item.id === failure.id);
    const observed = previous?.status && !failure.status && previous.url === failure.url
      ? { ...previous, error: failure.error } : { ...failure, receivedAt };
    const next = withFailure(session, { ...observed, priority: failurePriority(observed) });
    try {
      await save(next);
    } catch (error) {
      if (!/quota/i.test(error.message)) throw error;
      // Preserve the last stored snapshot and report that recording ended at the storage limit.
      const limited = { ...session, stopped: true, limitReached: true };
      await save(limited);
      await chrome.alarms.clear(alarmPrefix + tabId);
      await publishProgress(tabId, limited);
      return;
    }
    if (next.failures.length !== session.failures.length) {
      await publishProgress(tabId, next);
    }
  }).catch((error) => console.warn("FlowGPT diagnostics could not save a network event", error.name));
}

chrome.webRequest.onHeadersReceived.addListener(record, networkFilter, ["responseHeaders"]);
chrome.webRequest.onErrorOccurred.addListener(record, networkFilter);

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "complete" || !requestUrl(tab.url)) return;
  void update(tabId, async () => {
    const session = await readSession(tabId);
    if (!session) return;
    const current = await identifyBlockPage(tabId, tab.url, session);
    await publishProgress(tabId, current, isRecording(current));
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void update(tabId, () => clearSession(tabId)).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(alarmPrefix)) return;
  const tabId = Number(alarm.name.slice(alarmPrefix.length));
  if (!Number.isInteger(tabId) || tabId < 0) return;
  void update(tabId, async () => {
    const session = await readSession(tabId);
    if (session && !isRecording(session)) await publishProgress(tabId, session);
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.action === "hide-progress" && sender.tab && sender.frameId === 0 && requestUrl(sender.url)) {
    const tabId = sender.tab.id;
    update(tabId, async () => {
      const session = await readSession(tabId);
      if (!session) return;
      const next = { ...session, panelHidden: true };
      await save(next);
      await publishProgress(tabId, next);
    }).then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
  if (sender.url !== chrome.runtime.getURL("popup.html")) return false;
  if (!["start", "stop", "clear"].includes(message?.action)) return false;
  const { tabId } = message;
  if (!Number.isInteger(tabId) || tabId < 0) return false;
  update(tabId, async () => {
    if (message.action === "clear") {
      await clearSession(tabId);
      await publishProgress(tabId, null);
      return;
    }
    if (message.action === "stop") {
      const session = await readSession(tabId);
      if (session && !session.stopped) {
        const stopped = { ...session, stopped: true, stoppedAt: Date.now() };
        await save(stopped);
        await chrome.alarms.clear(alarmPrefix + tabId);
        await publishProgress(tabId, stopped);
      }
      return;
    }
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || !requestUrl(tab.url)) throw new Error("Open FlowGPT or Emochi in this tab first.");
    const startedAt = Date.now();
    const next = {
      id: crypto.randomUUID(), tabId, startedAt, endsAt: startedAt + WINDOW_MS,
      failures: [], stopped: false, limitReached: false,
    };
    await save(next);
    await chrome.alarms.create(alarmPrefix + tabId, { when: next.endsAt });
    await publishProgress(tabId, next, true);
  }).then(() => respond({ ok: true }), (error) => respond({ error: error.message }));
  return true;
});
