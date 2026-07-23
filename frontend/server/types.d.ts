/** Shape of a failed `$fetch`, before it is normalized — carries the API URL in several fields. */
export interface IFetchNativeError {
  data?: unknown;
  statusCode: number;
  statusMessage?: string;
  message?: string;
  url?: string;
  stack?: string[];
}

/** What the browser is allowed to see about a failure: a status and a message, never a URL. */
export interface IApiError {
  statusCode: number;
  error: string;
}
