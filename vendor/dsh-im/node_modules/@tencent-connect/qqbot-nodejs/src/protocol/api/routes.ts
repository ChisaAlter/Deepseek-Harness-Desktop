/**
 * Centralized API route templates for the QQ Open Platform.
 *
 * Eliminates C2C/Group path duplication by parameterizing on `ChatScope`.
 */

import type { ChatScope } from "../types.js";

export function messagePath(scope: ChatScope, targetId: string): string {
  return scope === "c2c" ? `/v2/users/${targetId}/messages` : `/v2/groups/${targetId}/messages`;
}

export function channelMessagePath(channelId: string): string {
  return `/channels/${channelId}/messages`;
}

export function dmMessagePath(guildId: string): string {
  return `/dms/${guildId}/messages`;
}

export function mediaUploadPath(scope: ChatScope, targetId: string): string {
  return scope === "c2c" ? `/v2/users/${targetId}/files` : `/v2/groups/${targetId}/files`;
}

export function uploadPreparePath(scope: ChatScope, targetId: string): string {
  return scope === "c2c"
    ? `/v2/users/${targetId}/upload_prepare`
    : `/v2/groups/${targetId}/upload_prepare`;
}

export function uploadPartFinishPath(scope: ChatScope, targetId: string): string {
  return scope === "c2c"
    ? `/v2/users/${targetId}/upload_part_finish`
    : `/v2/groups/${targetId}/upload_part_finish`;
}

export function uploadCompletePath(scope: ChatScope, targetId: string): string {
  return mediaUploadPath(scope, targetId);
}

export function streamMessagePath(openid: string): string {
  return `/v2/users/${openid}/stream_messages`;
}

export function gatewayPath(): string {
  return "/gateway";
}

export function interactionPath(interactionId: string): string {
  return `/interactions/${interactionId}`;
}

/**
 * Generate a message sequence number in the 0..65535 range.
 *
 * Used by both `messages.ts` and `media.ts` to avoid duplicate definitions.
 */
export function getNextMsgSeq(_msgId: string): number {
  const timePart = Date.now() % 100_000_000;
  const random = Math.floor(Math.random() * 65536);
  return (timePart ^ random) % 65536;
}
