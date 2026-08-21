import type { H3Event } from 'h3';

export const REFRESH_TOKEN_COOKIE = 'zydock_refresh_token';

const REFRESH_TOKEN_COOKIE_PATH = '/api/proxy/auth';

export const setRefreshTokenCookie = (event: H3Event, refreshToken: string) => {
  setCookie(event, REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_TOKEN_COOKIE_PATH,
  });
};

export const clearRefreshTokenCookie = (event: H3Event) => {
  deleteCookie(event, REFRESH_TOKEN_COOKIE, { path: REFRESH_TOKEN_COOKIE_PATH });
};

export const readRefreshTokenCookie = (event: H3Event) => getCookie(event, REFRESH_TOKEN_COOKIE);
