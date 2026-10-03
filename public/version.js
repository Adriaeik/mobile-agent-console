export const API_PROTOCOL_VERSION = 2;

export class IncompatibleServerError extends Error {
  constructor() {
    super("The server and web app versions do not match. Restart the console service, then reload this page.");
    this.name = "IncompatibleServerError";
  }
}

export function assertCompatibleConfig(config) {
  if (config?.apiProtocol !== API_PROTOCOL_VERSION || typeof config?.instanceId !== "string" || !config.instanceId) {
    throw new IncompatibleServerError();
  }
  return config;
}

export function deploymentChanged(previousInstanceId, nextInstanceId) {
  return Boolean(previousInstanceId && nextInstanceId && previousInstanceId !== nextInstanceId);
}
