import type {
  ComposerAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import type { AgentAttachment } from "@chisacode/protocol/messages";

export function isWorkspaceAttachment(
  attachment: ComposerAttachment | undefined,
): attachment is WorkspaceComposerAttachment {
  return attachment?.kind === "review" || attachment?.kind === "browser_element";
}

export function userAttachmentsOnly(
  attachments: readonly ComposerAttachment[],
): UserComposerAttachment[] {
  return attachments.filter(
    (attachment): attachment is UserComposerAttachment =>
      attachment.kind !== "review" && attachment.kind !== "browser_element",
  );
}

export function workspaceAttachmentToSubmitAttachment(
  attachment: ComposerAttachment,
): AgentAttachment | null {
  if (attachment.kind === "browser_element") {
    return {
      type: "text",
      mimeType: "text/plain",
      title: `浏览器元素 · ${attachment.attachment.tag}`,
      text: attachment.attachment.formatted,
    };
  }
  return attachment.kind === "review" ? attachment.attachment : null;
}
