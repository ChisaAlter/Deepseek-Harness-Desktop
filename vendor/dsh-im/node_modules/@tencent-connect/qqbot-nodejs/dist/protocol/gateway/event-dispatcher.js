/**
 * Event dispatcher — convert raw WebSocket op=0 events into typed events.
 *
 * Pure mapping logic with zero side effects.
 */
import { readOptionalMessageSceneExt } from "./codec.js";
import { GatewayEvent } from "./constants.js";
const REF_INDEX_KEY = "msg_idx";
/**
 * Parse `ref_idx` and `msg_idx` from message_scene.ext + msg_elements.
 */
function parseRefIndices(ext, msgType, msgElements) {
    let refMsgIdx;
    let msgIdx;
    if (Array.isArray(ext)) {
        for (const entry of ext) {
            if (typeof entry !== "string") {
                continue;
            }
            const eq = entry.indexOf("=");
            if (eq < 0) {
                continue;
            }
            const key = entry.slice(0, eq).trim();
            const val = entry.slice(eq + 1).trim();
            if (!val) {
                continue;
            }
            if (key === REF_INDEX_KEY) {
                msgIdx = val;
            }
            else if (key === "ref_msg_idx") {
                refMsgIdx = val;
            }
        }
    }
    if (msgType === 103 && Array.isArray(msgElements)) {
        for (const el of msgElements) {
            if (el?.msg_idx) {
                refMsgIdx = el.msg_idx;
                break;
            }
        }
    }
    return { refMsgIdx, msgIdx };
}
export function dispatchEvent(eventType, data, _accountId, _log) {
    if (eventType === GatewayEvent.READY) {
        const d = data;
        return { action: "ready", data, sessionId: d.session_id };
    }
    if (eventType === GatewayEvent.RESUMED) {
        return { action: "resumed", data };
    }
    if (eventType === GatewayEvent.C2C_MESSAGE_CREATE) {
        const ev = data;
        const refs = parseRefIndices(ev.message_scene?.ext, ev.message_type, ev.msg_elements);
        return {
            action: "message",
            msg: {
                rawEventType: eventType,
                kind: "c2c",
                senderId: ev.author.user_openid,
                content: ev.content,
                messageId: ev.id,
                timestamp: ev.timestamp,
                attachments: ev.attachments,
                refMsgIdx: refs.refMsgIdx,
                msgIdx: refs.msgIdx,
                msgType: ev.message_type,
                messageScene: ev.message_scene,
                msgElements: ev.msg_elements,
                raw: ev,
            },
        };
    }
    if (eventType === GatewayEvent.AT_MESSAGE_CREATE) {
        const ev = data;
        const refs = parseRefIndices(readOptionalMessageSceneExt(ev));
        return {
            action: "message",
            msg: {
                rawEventType: eventType,
                kind: "guild",
                senderId: ev.author.id,
                senderName: ev.author.username,
                content: ev.content,
                messageId: ev.id,
                timestamp: ev.timestamp,
                channelId: ev.channel_id,
                guildId: ev.guild_id,
                attachments: ev.attachments,
                refMsgIdx: refs.refMsgIdx,
                msgIdx: refs.msgIdx,
                raw: ev,
            },
        };
    }
    if (eventType === GatewayEvent.DIRECT_MESSAGE_CREATE) {
        const ev = data;
        const refs = parseRefIndices(readOptionalMessageSceneExt(ev));
        return {
            action: "message",
            msg: {
                rawEventType: eventType,
                kind: "dm",
                senderId: ev.author.id,
                senderName: ev.author.username,
                content: ev.content,
                messageId: ev.id,
                timestamp: ev.timestamp,
                guildId: ev.guild_id,
                attachments: ev.attachments,
                refMsgIdx: refs.refMsgIdx,
                msgIdx: refs.msgIdx,
                raw: ev,
            },
        };
    }
    if (eventType === GatewayEvent.GROUP_AT_MESSAGE_CREATE ||
        eventType === GatewayEvent.GROUP_MESSAGE_CREATE) {
        const ev = data;
        const refs = parseRefIndices(ev.message_scene?.ext, ev.message_type, ev.msg_elements);
        return {
            action: "message",
            msg: {
                rawEventType: eventType,
                kind: "group",
                senderId: ev.author.member_openid,
                senderName: ev.author.username,
                senderIsBot: ev.author.bot,
                content: ev.content,
                messageId: ev.id,
                timestamp: ev.timestamp,
                groupOpenid: ev.group_openid,
                attachments: ev.attachments,
                refMsgIdx: refs.refMsgIdx,
                msgIdx: refs.msgIdx,
                msgType: ev.message_type,
                mentions: ev.mentions,
                messageScene: ev.message_scene,
                msgElements: ev.msg_elements,
                raw: ev,
            },
        };
    }
    if (eventType === GatewayEvent.INTERACTION_CREATE) {
        return { action: "interaction", event: data };
    }
    // All other gateway events are forwarded as raw events.
    // This covers guild/group/friend lifecycle, reactions, and any future
    // platform events — zero SDK changes required for new event types.
    return { action: "raw", type: eventType, data };
}
//# sourceMappingURL=event-dispatcher.js.map