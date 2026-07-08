/**
 * Slack Web API client (native fetch).
 *
 * Read path (there is no first-class Canvas-read API):
 *   conversations.info -> channel.properties.canvas file id
 *   files.info         -> url_private + edit_timestamp
 *   authenticated GET of url_private (Bearer token) -> HTML content
 * Write path:
 *   chat.postMessage with a USER token -> message authored by the owner; <!here> notifies the channel.
 *
 * A single xoxp user token (files:read + channels:read/groups:read + chat:write) covers all of this.
 */
import type { Config } from "./config";

const API = "https://slack.com/api";

export interface SlackError extends Error {
  slackError?: string;
}

async function slackApi<T = Record<string, unknown>>(
  token: string,
  method: string,
  params: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) {
    const err: SlackError = new Error(`Slack ${method} failed: ${json.error ?? "unknown_error"}`);
    err.slackError = json.error;
    throw err;
  }
  return json;
}

interface CanvasFileInfo {
  urlPrivate: string;
  editTimestamp: number | null;
}

/** Resolve the Canvas file id for a channel (channel.properties.canvas). */
export async function resolveCanvasFileId(token: string, channelId: string): Promise<string> {
  const info = await slackApi<{ channel?: { properties?: { canvas?: unknown } } }>(
    token,
    "conversations.info",
    { channel: channelId },
  );
  const canvas = info.channel?.properties?.canvas as
    | { file_id?: string }
    | string
    | undefined;
  const fileId = typeof canvas === "string" ? canvas : canvas?.file_id;
  if (!fileId) {
    throw new Error(
      `Channel ${channelId} has no Canvas (channel.properties.canvas is empty). Create a Canvas in that channel, or set SLACK_CANVAS_ID directly.`,
    );
  }
  return fileId;
}

/** Fetch file metadata (url_private + last-edit timestamp) for a Canvas file id. */
export async function getCanvasFileInfo(token: string, fileId: string): Promise<CanvasFileInfo> {
  const info = await slackApi<{
    file?: { url_private?: string; url_private_download?: string; edit_timestamp?: number; updated?: number };
  }>(token, "files.info", { file: fileId });
  const url = info.file?.url_private ?? info.file?.url_private_download;
  if (!url) throw new Error(`files.info returned no url_private for file ${fileId}.`);
  // For canvases, `updated` tracks content regeneration and is often fresher than edit_timestamp.
  const editTimestamp =
    Math.max(info.file?.edit_timestamp ?? 0, info.file?.updated ?? 0) || null;
  return { urlPrivate: url, editTimestamp };
}

/** Authenticated download of a Slack private file URL. Guards the classic "HTML login page" trap.
 * Cache-busts so an edited Canvas isn't served from a stale cache/CDN copy. */
export async function downloadPrivateFile(token: string, url: string): Promise<string> {
  const bust = `${url.includes("?") ? "&" : "?"}_cb=${Date.now()}`;
  const res = await fetch(`${url}${bust}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Canvas download failed: HTTP ${res.status}.`);
  }
  // If the Bearer header was dropped/invalid, Slack serves an HTML login/redirect page.
  if (/text\/html/i.test(contentType) && /sign in|redirecting|login/i.test(body)) {
    throw new Error(
      "Canvas download returned an HTML login page — the token likely lacks files:read or was not sent. Aborting rather than parsing garbage.",
    );
  }
  return body;
}

/** Full Canvas read: resolve file id (if needed), get url_private, download the content. */
export async function readCanvas(
  config: Config,
): Promise<{ raw: string; editTimestamp: number | null }> {
  const fileId = config.canvasId ?? (await resolveCanvasFileId(config.slackToken, config.canvasChannelId!));
  const { urlPrivate, editTimestamp } = await getCanvasFileInfo(config.slackToken, fileId);
  const raw = await downloadPrivateFile(config.slackToken, urlPrivate);
  return { raw, editTimestamp };
}

/** Post a message as the token's user. `text` should already contain <!here> when a ping is wanted. */
export async function postMessage(token: string, channel: string, text: string): Promise<void> {
  await slackApi(token, "chat.postMessage", {
    channel,
    text,
    // Broadcast tokens (<!here>) are parsed from text; no special params needed. Disable link unfurling.
    unfurl_links: "false",
    unfurl_media: "false",
  });
}

/** Send a plain (no @here) alert to the owner about a parse/read problem. */
export async function alertOwner(config: Config, text: string): Promise<void> {
  try {
    await postMessage(config.slackToken, config.ownerAlertTarget, `⚠️ Namaz reminder: ${text}`);
  } catch {
    // Never let alerting failure crash the tick.
  }
}
