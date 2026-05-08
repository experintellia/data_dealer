// Render-side `ButtonInline` — a Text subclass styled as an inline
// button (`display: inline-block; position: relative`), with no
// position / transform handling so the host's CSS layout owns
// placement.  Used by Statusbar / MainMenu / popup chrome for the
// hand-styled button widgets. The legacy `textFontSize` property is
// preserved for any external config callers.

import { type NodeConfig } from './RenderNode.js';
import { RenderText, type TextConfig } from './RenderText.js';
import { getRenderJQuery } from './_jqueryShim.js';

export type ButtonInlineConfig = TextConfig & {
  textFontSize?: string;
};

export class RenderButtonInline extends RenderText {
  textFontSize: string;

  constructor(config: ButtonInlineConfig = {}) {
    const $ = getRenderJQuery('RenderButtonInline');
    const jdomelem = $("<div class='Button'></div>");
    // Mirror the legacy in-constructor defaults that override Text /
    // RenderNode prototype values (display='inline-block',
    // position='relative', textAlign='center').
    super({
      display: 'inline-block',
      position: 'relative',
      textAlign: config.textAlign ?? 'center',
      ...config,
      jdomelem: jdomelem,
    } as TextConfig & NodeConfig);
    this.textFontSize = config.textFontSize ?? '20px';
  }

  // Buttons are placed by the host's CSS, not the render transform
  // pipeline — disable both setPosition and setTransform so the
  // base RenderNode draw logic stays a no-op for layout purposes.
  override setPosition(): void {
    return;
  }

  override setTransform(): void {
    return;
  }
}
