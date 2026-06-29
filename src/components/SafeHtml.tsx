import { memo, createElement, type ElementType } from 'react';

const ALLOWED_TAGS = ['cmd', 'kv', 'list', 'span', 'div', 'br'];

interface SafeHtmlProps {
  html: string;
  className?: string;
  tag?: ElementType;
}

/**
 * Validate a `style="..."` attribute value. Only a small, safe subset of CSS
 * properties is permitted to prevent attribute-breakout XSS.
 */
function isSafeStyle(style: string): boolean {
  // Reject if it contains characters that could break out of the attribute.
  if (/[<>"]/.test(style)) return false;
  // Only allow `property: value;` pairs with known color/font properties.
  const allowedProps = /^(color|background-color|font-weight|font-style|opacity|text-decoration|margin|padding)\s*:/i;
  return style.split(';').every((decl) => {
    const trimmed = decl.trim();
    if (!trimmed) return true;
    return allowedProps.test(trimmed);
  });
}

function parseSafeHtml(html: string): string {
  // Step 1: escape everything. Note: quotes are NOT escaped here, so they
  // remain literal in the escaped text and can be matched directly.
  let escaped = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Step 2: selectively re-enable whitelisted tags.
  // Tags may have NO attributes, or a single `style="..."` attribute that is
  // strictly validated. All other attributes (including event handlers like
  // onclick) are stripped by not matching.
  for (const tag of ALLOWED_TAGS) {
    // Opening tag with a single style attribute: <tag style="..."> or <tag style='...'>
    // The quote char is captured and used as a backreference to match the closing quote.
    escaped = escaped.replace(
      new RegExp(`&lt;${tag}\\s+style=("|')([^&]*?)\\1&gt;`, 'g'),
      (_m, _q, styleVal) => {
        if (isSafeStyle(styleVal)) {
          return `<${tag} style="${styleVal}">`;
        }
        return `<${tag}>`;
      },
    );
    // Opening tags without attributes: <tag>
    escaped = escaped.replace(
      new RegExp(`&lt;${tag}&gt;`, 'g'),
      `<${tag}>`
    );
    // Closing tags: </tag>
    escaped = escaped.replace(
      new RegExp(`&lt;/${tag}&gt;`, 'g'),
      `</${tag}>`
    );
  }

  return escaped;
}

export const SafeHtml = memo(function SafeHtml({ html, className, tag: Tag = 'span' }: SafeHtmlProps) {
  const safe = parseSafeHtml(html);
  return createElement(Tag, { className, dangerouslySetInnerHTML: { __html: safe } });
});
