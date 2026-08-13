import { Fragment, jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime';
import { wrapIntrinsic } from './runtime-core';
export { Fragment };
export type { JSX } from 'react/jsx-dev-runtime';
export const jsxDEV: typeof reactJsxDEV = ((type, props, key, isStaticChildren, source, self) => { const wrapped = wrapIntrinsic(type, props as Record<string, unknown> | null); return reactJsxDEV(wrapped.type, wrapped.props, key, typeof type === 'string' ? false : isStaticChildren, source, self); }) as typeof reactJsxDEV;
