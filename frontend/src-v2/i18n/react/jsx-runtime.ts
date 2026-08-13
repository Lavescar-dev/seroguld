import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime';
import { wrapIntrinsic } from './runtime-core';
export { Fragment };
export type { JSX } from 'react/jsx-runtime';
export const jsx: typeof reactJsx = ((type, props, key) => { const wrapped = wrapIntrinsic(type, props as Record<string, unknown> | null); return reactJsx(wrapped.type, wrapped.props, key); }) as typeof reactJsx;
export const jsxs: typeof reactJsxs = ((type, props, key) => { const wrapped = wrapIntrinsic(type, props as Record<string, unknown> | null); return typeof type === 'string' ? reactJsx(wrapped.type, wrapped.props, key) : reactJsxs(wrapped.type, wrapped.props, key); }) as typeof reactJsxs;
