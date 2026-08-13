import { createElement, forwardRef, useContext, type ElementType } from 'react';
import { translateVisibleCopy } from '../copy';
import { LocaleRuntimeContext, LocalizationSkipContext } from './context';

const TRANSLATED_ATTRIBUTES = new Set(['placeholder', 'title', 'aria-label', 'aria-valuetext', 'alt', 'label']);
const SKIPPED_TAGS = new Set(['script', 'style', 'code', 'pre', 'textarea']);
type HostWrapperProps = { tag: string; originalProps: Record<string, unknown> };

function translatedChildren(value: unknown, locale: 'tr' | 'en' | 'da'): unknown {
  if (typeof value === 'string') return translateVisibleCopy(value, locale);
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? translateVisibleCopy(item, locale) : item);
  return value;
}

export const LocalizedHost = forwardRef<unknown, HostWrapperProps>(function LocalizedHost({ tag, originalProps }, ref) {
  const locale = useContext(LocaleRuntimeContext);
  const inheritedSkip = useContext(LocalizationSkipContext);
  const ownSkip = originalProps['data-i18n-skip'] === true || originalProps['data-i18n-skip'] === 'true';
  const skip = inheritedSkip || ownSkip || SKIPPED_TAGS.has(tag) || Boolean(originalProps.dangerouslySetInnerHTML);
  const next: Record<string, unknown> = { ...originalProps, ref };
  if (!skip) {
    next.children = translatedChildren(next.children, locale);
    for (const attribute of TRANSLATED_ATTRIBUTES) {
      if (typeof next[attribute] === 'string') next[attribute] = translateVisibleCopy(next[attribute] as string, locale);
    }
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(String(next.type || '').toLowerCase()) && typeof next.value === 'string') {
      next.value = translateVisibleCopy(next.value, locale);
    }
  }
  const node = createElement(tag, next as Record<string, unknown>);
  return ownSkip && !inheritedSkip ? createElement(LocalizationSkipContext.Provider, { value: true }, node) : node;
});
LocalizedHost.displayName = 'LocalizedHost';

export function wrapIntrinsic(type: ElementType, props: Record<string, unknown> | null) {
  if (typeof type !== 'string') return { type, props };
  const source = props || {};
  const { ref, ...originalProps } = source;
  return { type: LocalizedHost, props: { tag: type, originalProps, ...(ref === undefined ? {} : { ref }) } };
}
