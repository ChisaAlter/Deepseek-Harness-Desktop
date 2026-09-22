import type { BinaryNode } from '../WABinary/index.js';
/**
 * Builds an ACK stanza for a received node.
 * Pure function -- no I/O, no side effects.
 *
 * Mirrors WhatsApp Web's ACK construction:
 * - WAWebHandleMsgSendAck.sendAck / sendNack
 * - WAWebCreateNackFromStanza.createNackFromStanza
 */
export declare function buildAckStanza(node: BinaryNode, errorCode?: number, meId?: string): BinaryNode;
//# sourceMappingURL=stanza-ack.d.ts.map