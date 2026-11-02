import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request values that deep services need without passing them through every call. */
export interface RequestContext {
  userId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** The signed-in user of the current request, if any (set by AccessGuard). */
export const currentUserId = () => requestContext.getStore()?.userId;
