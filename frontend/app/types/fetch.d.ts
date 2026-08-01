import 'ofetch';

declare module 'ofetch' {
  interface FetchOptions {
    skipAuth?: boolean;
  }
}
