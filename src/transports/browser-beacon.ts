import type { ReportRecord, ReportTransport } from '../core/types.js';

export interface BeaconTransportOptions {
  /** Inject for testing or non-standard browser environments. */
  sendBeacon?: SendBeaconLike;
  serialize?: (record: ReportRecord) => string;
  url: string;
}

export type SendBeaconLike = (url: string, body: string) => boolean;

/** No page lifecycle listener is installed. Beacon is called only by send(record). */
export function browserBeaconTransport(options: BeaconTransportOptions): ReportTransport {
  if (!options.url) {
    throw new TypeError('Beacon transport requires a url.');
  }

  return {
    async send(record): Promise<void> {
      const beacon = options.sendBeacon ?? getSendBeacon();
      const accepted = beacon(options.url, (options.serialize ?? JSON.stringify)(record));
      if (!accepted) {
        throw new Error('navigator.sendBeacon() did not accept the payload.');
      }
    },
  };
}

function getSendBeacon(): SendBeaconLike {
  const nav = (
    globalThis as {
      navigator?: { sendBeacon?: SendBeaconLike };
    } & typeof globalThis
  ).navigator;
  const candidate = nav?.sendBeacon;
  if (typeof candidate !== 'function') {
    throw new Error('navigator.sendBeacon is unavailable.');
  }
  return candidate.bind(nav);
}
