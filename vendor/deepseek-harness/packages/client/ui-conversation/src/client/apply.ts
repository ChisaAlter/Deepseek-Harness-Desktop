/** Registers the target-neutral Conversation assembly, shell, input, and docks. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type BoundActions } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only service and declaration merges used by this assembly.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { UiConversation } from './conversation/assembly.ts'
import type { ViewTab } from './contract/views.ts'
import type {
  ComposerBarInjected, ConversationInjected, ConversationSessionHeaderInjected,
  ConversationSessionInjected,
} from './contract/slots.ts'
import type { InputNotice } from './contract/input.ts'
import { createConversationStore } from './stores.ts'
import { ConversationController, UnsupportedImageMediaTypeError } from './service.ts'
import type { IConversation } from './service.ts'
import { ComposerBlockRegistry } from './input/blocks.ts'
import type { ComposerBlock } from './contract/composer-blocks.ts'
import { ComposerModelCatalogRegistry, ComposerModelFactRegistry } from './input/model-facts.ts'
import { InputHub } from './input/hub.ts'
import { ComposerSubmissionPolicy } from './input/submission-policy.ts'
import { queueDockEntry } from './queue/QueueDock.tsx'
import { EnterBehaviorRow } from './settings/EnterBehaviorRow.tsx'
import type { EnterBehaviorRowInjected } from './settings/EnterBehaviorRow.tsx'
import { BeamRow } from './settings/BeamRow.tsx'
import type { BeamRowInjected } from './settings/BeamRow.tsx'
import { ResizeRow } from './settings/ResizeRow.tsx'
import type { ResizeRowInjected } from './settings/ResizeRow.tsx'
import { StatsLineRow } from './settings/StatsLineRow.tsx'
import type { StatsLineRowInjected } from './settings/StatsLineRow.tsx'
import { PeakValleySettingsRow } from './settings/PeakValleyRow.tsx'
import type { PeakValleySettingsRowInjected } from './settings/PeakValleyRow.tsx'
import { CostSettingsRow } from './settings/CostSettingsRow.tsx'
import type { CostSettingsRowInjected } from './settings/CostSettingsRow.tsx'
import { ViewTabsRow } from './settings/ViewTabsRow.tsx'
import type { ViewTabsRowInjected } from './settings/ViewTabsRow.tsx'
import { PeakValleyRow, type PeakValleyRowInjected } from './chat/PeakValleyRow.tsx'
import { ConversationRoot } from './skeleton/ConversationRoot.tsx'
import { ConversationSession, ConversationSessionHeader } from './skeleton/ConversationSession.tsx'
import { InputBar } from './skeleton/InputBar.tsx'
import { todoDockEntry } from './skeleton/TodoPanel.tsx'
import { en, NS, zh, type ConversationKey } from './locales.ts'
import { CONVERSATION_SETTINGS_NAMESPACE, type ConversationSettings } from '../submission-settings.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Conversation shell, composer, queue, and dock copy. */
    conversation: ConversationKey
  }
}

/** Services required by the Conversation plugin. */
export const inject = [
  'slots', 'sessions', 'uiSession', 'uiWorkspace', 'locale', 'settingsScope',
]

// Stable no-session sources keep the renderer's observable-hook cache and
// hook order unchanged across current-Session transitions.
const ABSENT_NOTICES = {
  getSnapshot: (): InputNotice | null => null,
  subscribe: () => () => {},
}
const ABSENT_BLOCK = {
  getSnapshot: (): ComposerBlock | undefined => undefined,
  subscribe: () => () => {},
}
const EMPTY_LEXICON: ReadonlyMap<'/' | '@', readonly string[]> = new Map()
const ABSENT_LEXICON = {
  getSnapshot: () => EMPTY_LEXICON,
  subscribe: () => () => {},
}
const ABSENT_MENU_LAUNCHER = {
  getSnapshot: (): string | null => null,
  subscribe: () => () => {},
}
/** No session, therefore the composer beam stays on; same one-identity rule as above. */
const ABSENT_BEAM = {
  getSnapshot: (): boolean => true,
  subscribe: () => () => {},
}

interface WorkspaceNavigation {
  connectWorkspace(
    workspaceId: Parameters<ConversationInjected['selectWorkspace']>[0],
  ): Promise<SessionId>
}

/** Resolve the session-scoped Conversation action face, failing loud. */
function scopedConversation(sessions: ISessions, id: SessionId): IConversation {
  const scoped = sessions.scope(id)
  if (scoped === undefined) throw new Error(`ui-conversation: session "${id}" resolved no scope`)
  const conversation = scoped.get('conversation')
  if (conversation === undefined) {
    throw new Error('ui-conversation: conversation service unavailable through the session scope')
  }
  return conversation
}

/** Resolve package-internal attachment operations from the public service. */
function concreteConversation(ctx: Context): ConversationController {
  const conversation = ctx.get('conversation') as ConversationController | undefined
  if (conversation === undefined) throw new Error('ui-conversation: conversation service unavailable')
  return conversation
}

/**
 * Mount the Conversation core and target-neutral presentation.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  const sessions = ctx.sessions
  const slots = ctx.slots
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  const uiConversation = new UiConversation(ctx, sessions)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-conversation: dictionaries')
  const t = ctx.locale.bind(NS)
  const conversationStore = createConversationStore()
  const submissionPolicy = new ComposerSubmissionPolicy(
    ctx.settingsScope.bind<ConversationSettings>({ namespace: CONVERSATION_SETTINGS_NAMESPACE }),
  )

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'composer-enter',
    order: 20,
    locale: NS,
    inject: (): EnterBehaviorRowInjected => ({
      hooks: { busyEnter: submissionPolicy.busyEnter },
      setBusyEnter: (behavior) => { submissionPolicy.setBusyEnter(behavior) },
    }),
  }, EnterBehaviorRow))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'composer-beam',
    order: 50,
    locale: NS,
    inject: (): BeamRowInjected => ({
      hooks: { composerBeam: submissionPolicy.composerBeam, writable: submissionPolicy.writable },
      setComposerBeam: (value) => { submissionPolicy.setComposerBeam(value) },
    }),
  }, BeamRow))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'composer-resize',
    order: 60,
    locale: NS,
    inject: (): ResizeRowInjected => ({
      hooks: { composerResize: submissionPolicy.composerResize, writable: submissionPolicy.writable },
      setComposerResize: (value) => { submissionPolicy.setComposerResize(value) },
    }),
  }, ResizeRow))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'stats-line',
    order: 70,
    locale: NS,
    inject: (): StatsLineRowInjected => ({
      hooks: { statsLine: submissionPolicy.statsLine, writable: submissionPolicy.writable },
      setStatsLine: (value) => { submissionPolicy.setStatsLine(value) },
    }),
  }, StatsLineRow))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'official-peak-valley',
    order: 75, // directly below the session-stats row (70), above view-tabs (80)
    locale: NS,
    inject: (): PeakValleySettingsRowInjected => ({
      hooks: { peakValley: submissionPolicy.officialPeakValley, writable: submissionPolicy.writable },
      setPeakValley: (value) => { submissionPolicy.setOfficialPeakValley(value) },
    }),
  }, PeakValleySettingsRow))

  // The session-cost Interface row: the independent switch sits directly
  // below the session-stats row; the figure itself also requires a detected
  // DeepSeek API route, and its price panel lives beside it on the composer
  // dock.
  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'session-cost',
    order: 72, // directly below the session-stats row (70), above peak/valley (75)
    locale: NS,
    inject: (): CostSettingsRowInjected => ({
      hooks: {
        sessionCost: submissionPolicy.sessionCost,
        costPrices: submissionPolicy.sessionCostPrices,
        writable: submissionPolicy.writable,
      },
      setSessionCost: (value) => { submissionPolicy.setSessionCost(value) },
      setCostPrices: (prices) => { submissionPolicy.setSessionCostPrices(prices) },
      catalogModels,
    }),
  }, CostSettingsRow))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'view-tabs',
    order: 80,
    locale: NS,
    inject: (): ViewTabsRowInjected => ({
      hooks: { viewTabs: submissionPolicy.viewTabs, writable: submissionPolicy.writable },
      setViewTabs: (value) => { submissionPolicy.setViewTabs(value) },
    }),
  }, ViewTabsRow))

  const viewTabs = (): ViewTab[] => {
    const tabs: ViewTab[] = []
    for (const entry of slots.entries('conversation.view')) {
      /* v8 ignore next -- list registration validates id at load. */
      if (entry.options.id === undefined) continue
      tabs.push({
        id: entry.options.id,
        label: resolveSlotLabel(entry.options.label) ?? entry.options.id,
      })
    }
    return tabs
  }
  const conversationViews = createSnapshotStore<readonly ViewTab[]>(viewTabs())
  const refreshViews = (): void => {
    const current = conversationViews.getSnapshot()
    const next = viewTabs()
    if (current.length === next.length
      && current.every((tab, index) => {
        const candidate = next.at(index)
        return candidate !== undefined && tab.id === candidate.id && tab.label === candidate.label
      })) return
    conversationViews.set(next)
  }
  ctx.effect(() => {
    const disposeViews = slots.subscribe('conversation.view', refreshViews)
    const disposeLocale = ctx.locale.subscribe(refreshViews)
    return () => {
      disposeLocale()
      disposeViews()
    }
  }, 'ui-conversation: View roster')

  const inputHub = new InputHub(ctx, t)
  const composerBlocks = new ComposerBlockRegistry()

  // The model-fact registry: the same push direction publishes the session's
  // current provider route for composer-dock entries (see model-facts.ts).
  const composerModelFacts = new ComposerModelFactRegistry()
  const composerModelCatalog = new ComposerModelCatalogRegistry()
  // The settings row has no session scope, so its panel merges the models
  // every resident session directory advertises (duck-typed: the plugin may
  // be absent). The dock reads its own session's pushed catalog instead.
  const catalogModels = (): readonly { provider: string; id: string }[] => {
    const directories = ctx.get('modelDirectories') as unknown as
      | { catalogModelIds(): readonly { provider: string; id: string }[] }
      | undefined
    return directories?.catalogModelIds() ?? []
  }

  // Conversation assembly and input share the Session binding lifecycle. The
  // source roster is installed before any consuming Slot entry.
  ctx.uiSession.provide({
    hooks: ['conversation', 'input'],
    props: ['inputActions'],
    resolve: (binding) => {
      const shell = inputHub.shellFor(binding)
      return {
        hooks: {
          conversation: uiConversation.binding(binding).snapshot,
          input: shell.state,
        },
        props: { inputActions: shell.actions },
      }
    },
  })

  const registerConversationRoot = () => slots.register({
    name: 'conversation',
    locale: NS,
    children: {
      'conversation.session': { kind: 'single', scope: 'session' },
      'conversation.session.header': { kind: 'single', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
    },
    inject: (sessionId: SessionId | undefined): ConversationInjected => ({
      hooks: {
        composerBlock: sessionId === undefined ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId),
      },
      selectWorkspace: async (workspaceId) => {
        const nextId = await workspaceNavigation.connectWorkspace(workspaceId)
        if (sessionId !== undefined && nextId !== sessionId) {
          const from = inputHub.shell(sessionId)
          const draft = from.snapshot.draft
          const imageIds = from.snapshot.imageIds
          const next = inputHub.shell(nextId)
          if (imageIds.length === 0 || next.addImages(imageIds)) {
            if (draft !== '') {
              next.setDraft(draft)
              from.setDraft('')
            }
            if (imageIds.length > 0) {
              for (const id of imageIds) from.removeImage(id)
            }
          }
        }
        sessions.open(nextId)
      },
    }),
  }, ConversationRoot)

  const registerConversationSession = () => slots.register({
    name: 'conversation.session',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
    },
    store: conversationStore,
    inject: (sessionId: SessionId, _actions: BoundActions<typeof conversationStore>): ConversationSessionInjected => ({
      hooks: { conversationViews },
      bindDraftMirror: write => inputHub.shell(sessionId).bindMirror(write),
    }),
  }, ConversationSession)

  const registerConversationHeader = () => slots.register({
    name: 'conversation.session.header',
    locale: NS,
    children: {
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
    store: conversationStore,
    inject: (): ConversationSessionHeaderInjected => ({
      hooks: { conversationViews, viewTabs: submissionPolicy.viewTabs },
      open: (id) => { sessions.open(id) },
    }),
  }, ConversationSessionHeader)

  const registerComposerBar = () => slots.register({
    name: 'conversation.composer.bar',
    locale: NS,
    children: {
      'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.plan': { kind: 'single', scope: 'session' },
      'conversation.input.model': { kind: 'single', scope: 'session' },
    },
    inject: (sessionId: SessionId | undefined): ComposerBarInjected => {
      if (sessionId === undefined) {
        return {
          keyboard: undefined,
          addImages: undefined,
          removeImage: undefined,
          draftImages: undefined,
          resolveSubmitMode: (running, gesture, steeringAvailable) =>
            submissionPolicy.resolve(running, gesture, steeringAvailable),
          toggleCommandMenu: undefined,
          stop: undefined,
          command: undefined,
          hooks: {
            notices: ABSENT_NOTICES,
            lexicon: ABSENT_LEXICON,
            menuLauncher: ABSENT_MENU_LAUNCHER,
            composerBeam: ABSENT_BEAM,
            composerResize: submissionPolicy.composerResize,
            composerResizeHeight: submissionPolicy.composerResizeHeight,
            composerResizeWidth: submissionPolicy.composerResizeWidth,
          },
          setComposerResizeSize: (size) => { submissionPolicy.setComposerResizeSize(size) },
        }
      }
      const conversation = concreteConversation(ctx)
      const shell = inputHub.shell(sessionId)
      const inputTriggers = inputHub.inputTriggers(sessionId)
      return {
        keyboard: shell,
        addImages: (files) => {
          try {
            const images = conversation.createDraftImages(files)
            if (!shell.addImages(images.map(image => image.id))) {
              conversation.releaseDraftImages(images)
            }
            return null
          } catch (error: unknown) {
            if (error instanceof UnsupportedImageMediaTypeError) return t('image.unsupportedType')
            return error instanceof Error ? error.message : String(error)
          }
        },
        removeImage: (id) => {
          conversation.releaseDraftImage(id)
          shell.removeImage(id)
        },
        draftImages: ids => conversation.draftImages(ids),
        resolveSubmitMode: (running, gesture, steeringAvailable) =>
          submissionPolicy.resolve(running, gesture, steeringAvailable),
        toggleCommandMenu: inputTriggers === undefined
          ? undefined
          : (selection) => {
            shell.dismissPopup()
            const snapshot = shell.snapshot
            inputTriggers.toggleSource('command', {
              trigger: '/',
              query: '',
              quoted: false,
              position: snapshot.draft.slice(0, selection.start).trim() === '' ? 'leading' : 'inline',
              span: { ...selection, draftRev: snapshot.draftRev },
            })
          },
        stop: () => {
          scopedConversation(sessions, sessionId).cancel().catch(() => {
            // Stop failure is published through Session promptError.
          })
        },
        command: async (line) => {
          const session = sessions.binding(sessionId)?.session
          if (session === undefined) return false
          const result = await session.command(line)
          return result.ok && result.value.matched
        },
        hooks: {
          notices: shell.notices,
          lexicon: shell.lexicon,
          menuLauncher: inputTriggers?.launcher ?? ABSENT_MENU_LAUNCHER,
          composerBeam: submissionPolicy.composerBeam,
          composerResize: submissionPolicy.composerResize,
          composerResizeHeight: submissionPolicy.composerResizeHeight,
          composerResizeWidth: submissionPolicy.composerResizeWidth,
        },
        setComposerResizeSize: (size) => { submissionPolicy.setComposerResizeSize(size) },
      }
    },
  }, InputBar)

  slots.inject('conversation', function* () {
    yield registerConversationRoot()
    yield registerConversationSession()
    yield registerConversationHeader()
    yield registerComposerBar()
    // Peak/valley dock must wait for the conversation children table; a
    // bare register here throws when apply runs before layout declares
    // the conversation slot (apply-wiring).
    yield slots.register({
      name: 'conversation.composer.dock',
      id: 'peak-valley',
      order: 1,
      locale: NS,
      inject: (sessionId: SessionId): PeakValleyRowInjected => ({
        hooks: {
          peakValley: submissionPolicy.officialPeakValley,
          modelProvider: composerModelFacts.storeFor(sessionId),
          modelCatalog: composerModelCatalog.storeFor(sessionId),
          sessionCost: submissionPolicy.sessionCost,
          costPrices: submissionPolicy.sessionCostPrices,
        },
        setCostPrices: (prices) => { submissionPolicy.setSessionCostPrices(prices) },
      }),
    }, PeakValleyRow)
  })

  ctx.plugin(ConversationController, {
    input: inputHub,
    blocks: composerBlocks,
    modelFacts: composerModelFacts,
    modelCatalog: composerModelCatalog,
  })
  ctx.plugin(todoDockEntry)
  ctx.plugin(queueDockEntry)
}
