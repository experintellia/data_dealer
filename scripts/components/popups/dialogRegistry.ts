// Typed dialog dispatcher for the phase-2 notification-cue path
// (issue #80).  The cue site (`GameRoot.makeNotifications`) sets a
// `DialogSpec` instead of a loose `component` + `props` pair, so a
// rename of e.g. `LevelUpNotificationProps.xpToNext` surfaces a
// compile error at the cue rather than silently breaking the popup.
//
// Status popups don't go through here — they call
// `GameRoot.openPreactDialog(Component, props)` directly, where the
// generic already type-checks props against the component.

import type { ComponentType } from 'preact';
import { LevelUpNotification, type LevelUpNotificationProps } from './LevelUpNotification.js';
import { MissionPopup, type MissionPopupProps } from './MissionPopup.js';
import { NewItemsNotification, type NewItemsNotificationProps } from './NewItemsNotification.js';
import { TutorialNotification, type TutorialNotificationProps } from './TutorialNotification.js';

/** `onClose` is framework-injected by the dialog manager — cue sites
 *  supply everything else. */
type CueProps<P> = Omit<P, 'onClose'>;

/** Maps each cue variant to its component's full props type. */
interface DialogVariants {
  levelup: LevelUpNotificationProps;
  newItems: NewItemsNotificationProps;
  tutorial: TutorialNotificationProps;
  missionBriefing: MissionPopupProps;
  missionComplete: MissionPopupProps;
}

const REGISTRY: { [K in keyof DialogVariants]: ComponentType<DialogVariants[K]> } = {
  levelup: LevelUpNotification,
  newItems: NewItemsNotification,
  tutorial: TutorialNotification,
  missionBriefing: MissionPopup,
  missionComplete: MissionPopup,
};

/** Discriminated union — `{ variant, props }` with `props` typed to
 *  the variant's component (minus `onClose`). */
export type DialogSpec = {
  [K in keyof DialogVariants]: { variant: K; props: CueProps<DialogVariants[K]> };
}[keyof DialogVariants];

/** Resolve a spec to the concrete component + props the dialog
 *  manager mounts.  The cast is contained here — every cue site is
 *  type-checked against `DialogSpec`. */
export function resolveDialog(spec: DialogSpec): {
  component: ComponentType<{ onClose: () => void }>;
  props: Record<string, unknown>;
} {
  return {
    component: REGISTRY[spec.variant] as ComponentType<{ onClose: () => void }>,
    props: spec.props as Record<string, unknown>,
  };
}
