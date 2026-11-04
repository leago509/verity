import { mockApi } from './mock';
import { realApi } from './real';
import type { Api } from './types';

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
export const api: Api = USE_MOCK ? mockApi : realApi;
export { ApiError } from './types';
