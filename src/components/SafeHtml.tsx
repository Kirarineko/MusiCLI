import { memo, createElement, type ElementType } from 'react';

const ALLOWED_TAGS = ['cmd', 'kv', 'list', 'span', 'div', 'br'];

interface SafeHtmlProps {
  html: string;
  className?: string;
  tag?: ElementType;
}

function parseSafeHtml(html: string): string {
  // Escape first, then selectively unescape whitelisted tags
  let escaped = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  for (const tag of ALLOWED_TAGS) {
    // Opening tags with optional attributes: <tag attr="val"> or <tag>
    escaped = escaped.replace(
      new RegExp(`&lt;${tag}(\\s[^&]*?)&gt;`, 'g'),
      `<${tag}$1>`
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

  // Restore attribute quotes
  escaped = escaped.replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

  return escaped;
}

export const SafeHtml = memo(function SafeHtml({ html, className, tag: Tag = 'span' }: SafeHtmlProps) {
  const safe = parseSafeHtml(html);
  return createElement(Tag, { className, dangerouslySetInnerHTML: { __html: safe } });
});
