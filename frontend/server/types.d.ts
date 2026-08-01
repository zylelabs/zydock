export interface IFetchNativeResponseError {
  data: unknown;
  statusCode: number;
  statusMessage: string;
  error: boolean;
  message: string; // Contains original API URL leak
  url: string; // Contains original API URL leak
  stack: string[]; // Contains original API URL leak
}

export interface IFetchResponseError {
  statusCode: number;
  message: string;
  err?: any;
}
