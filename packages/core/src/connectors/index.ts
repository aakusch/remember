export type {
  Connector,
  ConnectorContext,
  ConnectorSyncResult,
  ConnectorStatus,
} from './types.js';
export { createObsidianConnector, type ObsidianConnectorOptions } from './obsidian.js';
export { createGranolaConnector, type GranolaConnectorOptions, type GranolaMeeting } from './granola.js';
export { createFilesystemConnector, type FilesystemConnectorOptions } from './filesystem.js';
export { createConnectorManager, type ConnectorManager, type ConnectorManagerOptions } from './manager.js';
export { resolveConnectors } from './resolve.js';
