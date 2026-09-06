/** Chat-only hiding of turns superseded by durable user-message replacements. */
import type { ChatConversationViewNode, ChatNode } from '../contract/chat-nodes.ts'
import type { ChatNodeStore } from '../contract/snapshot.ts'

/** Accumulates edit targets across live append, replay, and older-page materialization. */
export class EditedTurnProjector {
  private readonly turns = new Set<number>()

  /** @param nodes - complete loaded Chat nodes. @returns nodes with replaced turns hidden. */
  replace(nodes: readonly ChatConversationViewNode[]): readonly ChatConversationViewNode[] {
    this.turns.clear()
    this.collect(nodes)
    return nodes.map(node => this.project(node))
  }

  /**
   * @param upserts - changed nodes; a newly committed edit also revisits its older turn.
   * @param store - already materialized Chat nodes.
   * @returns changed nodes plus newly hidden rows.
   */
  apply(upserts: readonly ChatConversationViewNode[], store: ChatNodeStore): readonly ChatConversationViewNode[] {
    const changed = this.collect(upserts)
    const next = new Map(upserts.map(node => [node.key, this.project(node)]))
    if (changed) {
      for (const node of store.values()) {
        if (next.has(node.key)) continue
        const projected = this.project(node)
        if (projected !== node) next.set(node.key, projected)
      }
    }
    return [...next.values()]
  }

  private collect(nodes: readonly ChatConversationViewNode[]): boolean {
    const size = this.turns.size
    for (const raw of nodes) {
      const node = raw as ChatNode
      if (node.kind === 'user' && node.data.replacesTurn !== undefined) this.turns.add(node.data.replacesTurn)
    }
    return this.turns.size !== size
  }

  private project(node: ChatConversationViewNode): ChatConversationViewNode {
    if (node.superseded === true) return node
    const location = node.location
    return (location.kind === 'turn' || location.kind === 'step') && this.turns.has(location.turn.turn)
      ? { ...node, visibility: 'hidden', superseded: true }
      : node
  }
}
