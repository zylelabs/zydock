import { createComposeProvider } from './docker.provider';
import type { ComposeProvider } from './compose.contract';

const compose = createComposeProvider();

export const resolveComposeProvider = (): ComposeProvider => compose;

export type * from './compose.contract';
