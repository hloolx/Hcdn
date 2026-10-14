/** Where the "sign in / sign up" buttons go. Override with VITE_CONSOLE_URL at build time. */
export const CONSOLE_URL: string = (import.meta.env.VITE_CONSOLE_URL as string | undefined) ?? "https://console.hcdn.dev";
export const LOGIN_URL = `${CONSOLE_URL}/login`;
export const REGISTER_URL = `${CONSOLE_URL}/register`;
