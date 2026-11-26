import { isRecording, requestUrl } from "./diagnostics.js";
import { classifyFailure, failureTypes, requestAreas } from "./classification.js";
import { createZip } from "./zip.js";

function hideProgress(tabId, hidden) {
  return chrome.tabs.sendMessage(tabId, { type: "suspend-progress", hidden }, { frameId: 0 }).catch(() => {});
}

async function capturePage(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = requestUrl(tab.url);
  if (!tab.active || !url) throw new Error("Switch back to the FlowGPT or Emochi tab with the error.");
  await hideProgress(tab.id, true);
  let data;
  let capturedAt;
  try {
    data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    capturedAt = Date.now();
  } finally {
    await hideProgress(tab.id, false);
  }
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== tab.id || active.url !== tab.url) throw new Error("The tab changed. Return to the error and try again.");
  return { data, capturedAt, url: url.href };
}

function download(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function saveEvidence(tabId, report) {
  const capture = await capturePage(tabId);
  const screenshot = new Image();
  screenshot.src = capture.data;
  await screenshot.decode();
  const width = Math.min(1600, Math.max(880, screenshot.naturalWidth));
  const imageHeight = Math.round(screenshot.naturalHeight * width / screenshot.naturalWidth);
  const margin = 24;
  const lineHeight = 23;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const font = "16px monospace";
  context.font = font;
  const characters = Math.floor((width - 2 * margin) / context.measureText("M").width);
  const lines = report.split("\n").flatMap((line) => {
    const chunks = [];
    for (let index = 0; index < line.length; index += characters) chunks.push(line.slice(index, index + characters));
    return chunks;
  });
  const reportHeight = 2 * margin + lines.length * lineHeight;
  canvas.width = width;
  canvas.height = reportHeight + imageHeight;
  context.fillStyle = "#f7f6fc";
  context.fillRect(0, 0, width, reportHeight);
  context.fillStyle = "#282147";
  context.font = font;
  context.textBaseline = "top";
  lines.forEach((line, index) => context.fillText(line, margin, margin + index * lineHeight));
  context.drawImage(screenshot, 0, reportHeight, width, imageHeight);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not create the image. Copy the report and attach your screenshot.");
  download(blob, "flowgpt-connection-evidence.png");
}

export async function saveBundle(session, selected, report, vpn) {
  const snapshotAt = Date.now();
  const capture = await capturePage(session.tabId);
  const iso = (timestamp) => new Date(timestamp).toISOString();
  const recording = isRecording(session, snapshotAt);
  const status = session.limitReached ? "Storage limit reached" : recording ? "Recording in progress" : "Finished";
  const errors = session.failures.slice().sort((first, second) => first.at - second.at).map((failure) => {
    const { area, kind, signal } = classifyFailure(failure);
    return {
      time_utc: iso(failure.at),
      request_url: failure.url,
      request_area: requestAreas[area],
      failure_type: failureTypes[kind],
      classification_signal: signal,
      method: failure.method,
      http_status: failure.status ?? null,
      ray_id: failure.ray,
      cloudflare_challenge: failure.challenge,
      cloudflare_error_type: failure.cfErrorType ?? "",
      cloudflare_error_origin: failure.cfErrorOrigin ?? "",
      network_error: failure.error,
      request_type: failure.type,
      selected: failure.id === selected.id,
    };
  });
  const metadata = {
    started_at_utc: iso(session.startedAt),
    scheduled_end_utc: iso(session.endsAt),
    stopped_at_utc: session.stoppedAt ? iso(session.stoppedAt) : null,
    snapshot_at_utc: iso(snapshotAt),
    status,
    complete: !recording && !session.limitReached,
    error_count: errors.length,
    vpn_or_proxy: vpn,
    screenshot_page_url: capture.url,
    screenshot_time_utc: iso(capture.capturedAt),
  };
  const summary = [
    "Recording started (UTC): " + metadata.started_at_utc,
    "Snapshot taken (UTC): " + metadata.snapshot_at_utc,
    "Recording status: " + metadata.status,
    "Failed requests in this bundle: " + metadata.error_count,
    "Screenshot page: " + metadata.screenshot_page_url,
    "Screenshot taken (UTC): " + metadata.screenshot_time_utc,
    ...(recording ? ["This bundle includes the failures recorded so far."] : []),
    ...(session.limitReached ? ["Recording ended when Chrome’s session storage filled up. Additional failures may be missing."] : []),
  ];
  const csvCell = (value) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
  const columns = Object.keys(errors[0]);
  const csv = [columns, ...errors.map((entry) => columns.map((key) => entry[key]))]
    .map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const screenshot = new Uint8Array(await (await fetch(capture.data)).arrayBuffer());
  const archive = createZip([
    { name: "report.txt", data: report + "\n\n" + summary.join("\n") + "\n" },
    { name: "all-errors.csv", data: csv },
    { name: "all-errors.json", data: JSON.stringify({ recording: metadata, errors }, null, 2) + "\n" },
    { name: "screenshot.png", data: screenshot },
  ], capture.capturedAt);
  download(archive, "flowgpt-diagnostics-" + metadata.snapshot_at_utc.slice(0, 19).replaceAll(":", "-") + "Z.zip");
}
