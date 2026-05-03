// Global webxdc API type declarations for the Data Dealer webxdc port.
// Spec: https://docs.webxdc.org/spec.html#webxdc-api
//
// Included in tsconfig "types/**/*" so these globals are visible to all
// TypeScript sources and to JS files that opt in with // @ts-check.

/** Payload shape passed to webxdc.sendUpdate(). */
interface WebxdcSendUpdate {
  payload?: unknown;
  info?: string;
  summary?: string;
  document?: string;
}

/** Shape of updates delivered to the setUpdateListener callback. */
interface ReceivedUpdate extends WebxdcSendUpdate {
  /** Monotonically increasing serial number assigned by the messenger. */
  serial: number;
  /**
   * Highest serial the messenger had at the moment setUpdateListener was
   * registered; used to drive the replay-progress bar in bootstrap.js.
   */
  max_serial?: number;
}

/** The webxdc runtime API exposed on window.webxdc (and as a bare global). */
interface Webxdc {
  /** The user's own address string (stable identity; replaces auth_uid). */
  selfAddr: string;
  /** The user's display name as set in the messenger. */
  selfName: string;

  /**
   * Persist an update to the webxdc update history and fan it out to all
   * participants.  The messenger echoes the update back to the sender so
   * the setUpdateListener callback is the single state-mutation site.
   */
  sendUpdate(update: WebxdcSendUpdate, description?: string): void;

  /**
   * Register a listener for incoming updates.  The messenger replays all
   * updates with serial > `serial` before resolving the returned Promise,
   * enabling cold-start state reconstruction.
   */
  setUpdateListener(
    cb: (update: ReceivedUpdate) => void,
    serial?: number,
  ): Promise<void>;
}

// Declared both as a bare global (used with `typeof webxdc !== 'undefined'`
// guards in boot.js / LocalEngine.js) and as a Window property (used in
// webxdc-shim.ts).
declare var webxdc: Webxdc | undefined;

interface Window {
  webxdc?: Webxdc;
}
