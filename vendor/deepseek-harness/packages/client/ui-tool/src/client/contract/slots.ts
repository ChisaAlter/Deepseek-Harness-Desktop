/** Tool UI slot declarations and their composed component props. */
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { OpenFileOptions, ToolCallBlock, UseDisclosure } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageLoader, MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Keyed Tool call view dispatched by wire Tool name. Any name is allowed,
     * including tools registered by your package. Register with
     * `key: '<tool name>'`; a typo never renders.
     *
     * Registering an occupied key replaces its view; unclaimed keys use the
     * generic row. The owner supplies the call identity and frozen running
     * or settled node through ToolCallOwnerProps.
     */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallOwnerProps }
    /**
     * Durable images of a settled image-bearing Tool call, rendered through
     * the attachment presentation plugin. The Tool layer never imports an
     * attachment implementation: a toolview declares this slot as a child and
     * renders it with the image card's references plus the session-authorized
     * loader it received in its owner, and the attachment plugin fills the
     * gallery. Composing no attachment presentation plugin renders nothing,
     * which is why the image card keeps its own envelope text beside the
     * gallery. A child slot is declared by exactly one entry: registering a
     * second toolview that declares the same child throws at load, so a
     * future image-bearing tool must reuse this entry or own a distinct
     * slot.
     */
    'tool.call.images': { kind: 'single'; scope: 'session'; owner: ToolImagesOwnerProps }
  }
}

/** Owner currency of the Tool image gallery slot: references plus the loader. */
export interface ToolImagesOwnerProps {
  /** Durable references or submission-echo previews in result order. */
  images: readonly MessageImageSource[]
  /** Session-authorized image URL loader for the durable arm. */
  loadImage: MessageImageLoader
  /** Horizontal placement inside the owning record. */
  align: 'start' | 'end'
}

/** Standard owner currency supplied to every atomic Tool view. */
export interface ToolCallOwnerProps {
  /** Stable injected Hook; each invocation owns its open state and subscribes to enclosing-Turn resets. */
  useDisclosure: UseDisclosure
  /** Tool call identity, stable across running and settled forms. */
  callId: string
  /** Wire Tool name and keyed dispatch value. */
  toolName: string
  /** Frozen running call or settled result node. */
  block: ToolCallBlock
  /** Session workspace root for relative summaries. */
  cwd?: string | undefined
  /** Host account home; POSIX home-rooted summaries display as `~`. */
  home?: string | undefined
  /**
   * Open a Tool argument path. A view that knows which line the call was about
   * passes it, and the opened surface lands there.
   */
  openFile: (path: string, options?: OpenFileOptions) => void
  /**
   * Session-authorized image loader for the `tool.call.images` slot, supplied
   * by the chat node that owns this call. A composed chat node always
   * supplies it (`ChatNodeOwnerProps.loadImage` is required), so the tool
   * layer never imports an attachment implementation nor handles URL
   * authorization.
   */
  loadImage: MessageImageLoader
  /** Inspect this call in the trajectory view when available. */
  inspect?: (() => void) | undefined
}

/** Full props of a registered atomic Tool view. */
export type ToolCallViewProps = PropsRuntime<'tool.call.toolview'>

/** Injected Host description for POSIX home-path display. */
export type ToolHostInfoInjected = {
  hooks: {
    /**
     * Fixed Host facts, reached through a hook rather than injected as values:
     * the renderer memoizes an entry's inject result for the registration's
     * lifetime, so facts read there would freeze at whatever the first render
     * saw. Select the field the view needs (`info => info.home`).
     */
    hostInfo: HostObservable<RemoteHostFacts>
  }
}

/** Full props of the Tool call-tree renderer registered as a `tool-call` Chat Node. */
export type ToolTreeProps = PropsRuntime<'conversation.chat.node', 'tool-call'>
  & PropsRenderSlots<'tool.call.toolview'>
  & PropsLocale<'conversation'>
  & InjectFace<ToolHostInfoInjected>
