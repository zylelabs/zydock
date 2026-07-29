export interface IFetchNativeError {
  data?: unknown;
  statusCode: number;
  statusMessage?: string;
  message?: string;
  url?: string;
  stack?: string[];
}

export interface IApiError {
  statusCode: number;
  error: string;
}
