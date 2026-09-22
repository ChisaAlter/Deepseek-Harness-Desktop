/** Minimal markdown AST node shape used for recursive type checks */
export interface MarkdownAstNodeWithChildren {
  type: string;
  children: MarkdownAstNodeWithChildren[];
}

/**
 * Whether a markdown AST node or any descendant has the given type
 * @param node Root node to search
 * @param type Node type string to match
 * @returns True when the type appears in the subtree
 */
export function markdownNodeContainsType(node: MarkdownAstNodeWithChildren, type: string): boolean {
  if (node.type === type) {
    return true;
  }

  return node.children.some((child) => markdownNodeContainsType(child, type));
}
