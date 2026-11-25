import { classifyFailure, failurePriority, failureTypes, requestAreas } from "./classification.js";

export const WINDOW_MS = 5 * 60 * 1000;
export const HOSTS = ["flowgpt.com", "emochi.com", "flow.chat"];

export function sessionKey(tabId) {
  return "diagnostics:" + tabId;
}

export function requestUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !HOSTS.some((host) => url.hostname === host || url.hostname.endsWith("." + host))) {
      return null;
    }
    // Keep the request route while removing credentials, query parameters and fragments.
    return new URL(url.origin + url.pathname);
  } catch {
    return null;
  }
}

export function rayId(value = "") {
  const ray = /^([a-f0-9]{16})(?:-([a-z]{3}))?$/i.exec(value.trim());
  if (!ray) return "";
  return ray[1].toLowerCase() + (ray[2] ? "-" + ray[2].toUpperCase() : "");
}

export function ipAddress(value = "") {
  const ip = value.trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split(".").every((part) => Number(part) <= 255) ? ip : "";
  }
  if (!ip.includes(":") || !/^[a-f0-9:.]+$/i.test(ip)) return "";
  try {
    return new URL("https://[" + ip + "]/").hostname.slice(1, -1);
  } catch {
    return "";
  }
}

export function failureFrom(details) {
  const url = requestUrl(details.url);
  if (!url || url.pathname === "/cdn-cgi/trace" || url.pathname.startsWith("/cdn-cgi/challenge-platform/")) return null;
  const header = (name) => details.responseHeaders?.find((item) => item.name.toLowerCase() === name)?.value;
  const code = (name) => {
    const value = header(name)?.trim() ?? "";
    return /^[a-z0-9][a-z0-9_.:-]{0,63}$/i.test(value) ? value.toLowerCase() : "";
  };
  const status = details.statusCode;
  const challenge = header("cf-mitigated")?.trim().toLowerCase() === "challenge";
  const error = /^net::ERR_[A-Z0-9_]+$/.test(details.error) && details.error !== "net::ERR_ABORTED" ? details.error : "";
  if (!challenge && !error && !(status >= 400 && status < 600)) return null;
  const failure = {
    id: details.requestId,
    url: url.href,
    method: /^[A-Z]{1,16}$/.test(details.method) ? details.method : "",
    status,
    challenge,
    error,
    ray: rayId(header("cf-ray")),
    cfErrorType: code("cf-error-type"),
    cfErrorOrigin: code("cf-error-origin"),
    at: details.timeStamp,
    type: details.type,
  };
  return { ...failure, priority: failurePriority(failure) };
}

export function isRecording(session, now = Date.now()) {
  return Boolean(session && !session.stopped && now < session.endsAt);
}

export function captureProgress(session, now = Date.now()) {
  const active = isRecording(session, now);
  const count = session?.failures.length ?? 0;
  const captured = count + " failed " + (count === 1 ? "request" : "requests") + " recorded.";
  const state = { active, endsAt: session?.endsAt, count };
  if (!session) return { ...state, phase: "idle", label: "Not started", detail: "" };
  if (session.limitReached) return { ...state, phase: "ready", label: "Storage limit reached", detail: captured };
  if (active && count) return { ...state, phase: "detected", label: "Error detected", detail: captured };
  if (active) return { ...state, phase: "recording", label: "Recording", detail: "Repeat the action that failed in this tab." };
  if (count) return { ...state, phase: "ready", label: "Report ready", detail: captured };
  return { ...state, phase: "empty", label: "Finished", detail: "No failed requests were recorded." };
}

export function timeLeft(endsAt) {
  const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export function makeReport(failure, ip, vpn) {
  const time = new Date(failure.at);
  const local = time.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { area, kind, signal } = classifyFailure(failure);
  return [
    "FlowGPT connection report",
    "Request area: " + requestAreas[area],
    "Failure type: " + failureTypes[kind],
    "Request URL: " + failure.url,
    "Classification signal: " + signal,
    "Ray ID: " + (failure.ray || "Unavailable"),
    "Time (UTC): " + time.toISOString(),
    "Time (local): " + local + " (" + zone + ")",
    "Method: " + (failure.method || "Unavailable"),
    "HTTP status: " + (failure.status ?? "No HTTP response"),
    ...(failure.challenge ? ["Cloudflare response: challenge"] : []),
    ...(failure.cfErrorType ? ["Cloudflare error type: " + failure.cfErrorType] : []),
    ...(failure.cfErrorOrigin ? ["Cloudflare error origin: " + failure.cfErrorOrigin] : []),
    ...(failure.error ? ["Network error: " + failure.error] : []),
    "Public IP: " + (ip?.value || "Unavailable"),
    ...(ip ? ["IP source: " + ip.source] : []),
    "VPN or proxy: " + vpn,
  ].join("\n");
}
