// Shared Marco speech-bubble — Marco's portrait + says-label + speech
// text in a flex row, used by `popups/TutorialNotification`,
// `popups/LevelUpNotification`, and `popups/MissionPopup`.  Footer
// buttons (Mission's "OK, sounds good!", Tutorial's "tap anywhere
// to continue") render as siblings of <MarcoSpeech>, NOT children
// of it — mirrors the TutorialWrap pattern where the tap hint sits
// outside the speech card.
//
// CSS lives under `.MarcoSpeech` in `css/Render.css` — flex row with
// Marco bottom-aligned and the speech bubble + says label stacked in
// a flex column to his right.

export interface MarcoSpeechProps {
  /** "Marco says:" speaker label. */
  says: string;
  /** Speech bubble body HTML (legacy `<%= text %>`; may contain
   *  trusted ruleset `<span class="highlight">…</span>` markup). */
  bodyHtml: string;
}

export function MarcoSpeech({ says, bodyHtml }: MarcoSpeechProps) {
  return (
    <div class="MarcoSpeech">
      <div class="NotificationAvatar" />
      <div class="MarcoSpeechContent">
        <div class="NotificationSays">{says}</div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted ruleset / i18n string */}
        <div class="NotificationText" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </div>
    </div>
  );
}
