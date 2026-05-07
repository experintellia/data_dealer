// Render-side `ButtonInline` — a Text subclass styled as an inline
// button (`display: inline-block; position: relative`), with no
// position / transform handling so the host's CSS layout owns
// placement.  Used by Statusbar / MainMenu / popup chrome for the
// hand-styled button widgets.
//
// Extracted from scripts/Render.js's IIFE in PR 34 of issue #147.
// Trimmed since the legacy declared but never read `textFontSize` —
// preserved here verbatim for any external config callers.

import { type JQueryNodeElem, type NodeConfig } from './RenderNode.js';
import { RenderText, type TextConfig } from './RenderText.js';

interface JQueryButtonElem {
  0: HTMLElement;
  attr(name: string, value: string): unknown;
}

function getJQuery(): (selector: string) => JQueryButtonElem {
  const jq = (globalThis.jQuery ?? globalThis.$) as
    | ((selector: string) => JQueryButtonElem)
    | undefined;
  if (!jq) {
    throw new Error('RenderButtonInline requires the jQuery global to be loaded.');
  }
  return jq;
}

export type ButtonInlineConfig = TextConfig & {
  textFontSize?: string;
};

export class RenderButtonInline extends RenderText {
  textFontSize: string;

  constructor(config: ButtonInlineConfig = {}) {
    const $ = getJQuery();
    const jdomelem = $("<div class='Button'></div>");
    // Mirror the legacy in-constructor defaults that override Text /
    // RenderNode prototype values (display='inline-block',
    // position='relative', textAlign='center').
    super({
      display: 'inline-block',
      position: 'relative',
      textAlign: config.textAlign ?? 'center',
      ...config,
      jdomelem: jdomelem as unknown as JQueryNodeElem,
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
