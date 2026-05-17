// External link.  Centralises the `class="mln"` styling hook and the
// `target="_blank" rel="noreferrer noopener"` safety boilerplate so
// callers just give an href + label.

import type { ComponentChildren } from 'preact';

export interface LinkProps {
  href: string;
  children: ComponentChildren;
}

export function Link({ href, children }: LinkProps) {
  return (
    <a href={href} class="mln" target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}
