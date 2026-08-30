/** Session Controller events forwarded unchanged through the Remote Event carrier. */
export const SESSION_CONTROLLER_REMOTE_EVENTS = [
  'api-session/activity',
  'api-session/added',
  'api-session/error',
  'api-session/removed',
  'api-session/status',
] as const

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends
    Record<typeof SESSION_CONTROLLER_REMOTE_EVENTS[number], true> {}
}
