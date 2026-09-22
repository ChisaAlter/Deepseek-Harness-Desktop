/**
 * Browser entry for the ChisaCode protocol client used by mobile/web.
 * Re-exports pairing + DaemonClient surface — full stack, not hello-only.
 */
export { DaemonClient, createChisaCodeClient } from '@chisacode/client';

export {
  parseConnectionOfferFromUrl,
  decodeOfferFragmentPayload,
  ConnectionOfferSchema,
} from '@chisacode/protocol/connection-offer';

export {
  buildRelayWebSocketUrl,
  buildDaemonWebSocketUrl,
} from '@chisacode/protocol/daemon-endpoints';

export {
  RelayDeviceCredentialClient,
  MemoryRelayDeviceCredentialStore,
  createRelayDeviceId,
  computeClientRelayDeviceAuthProof,
} from '@chisacode/client/relay-device-credentials';
