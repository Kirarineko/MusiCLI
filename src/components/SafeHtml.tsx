import { memo, createElement, type ElementType } from 'react';

const ALLOWED_TAGS = ['cmd', 'kv', 'list', 'span', 'div', 'br'];

interface SafeHtmlProps {
  html: string;
  className?: string;
  tag?: ElementType;
}

function parseSafeHtml(html: string): string {
  let escaped = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  for (const tag of ALLOWED_TAGS) {
    escaped = escaped
      .replace(new RegExp(`&lt;${tag}\\b`, 'g'), `<${tag}`)
      .replace(new RegExp(`&lt;/${tag}&gt;`, 'g'), `</${tag}>`);
    escaped = escaped.replace(
      new RegExp(`&lt;${tag}([^&]*?)&gt;`, 'g'),
      (_, attrs) => {
        const decoded = attrs.replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
        return `<${tag}${decoded}>`;
      }
    );
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
