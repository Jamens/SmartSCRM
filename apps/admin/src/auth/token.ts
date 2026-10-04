// Holds the current access token outside of React/zustand so the HTTP client can
// read it without creating an import cycle (client <- store <- api <- client).
let currentToken: string | null = null;

export const tokenStore = {
  get: (): string | null => currentToken,
  set: (t: string | null): void => {
    currentToken = t;
  },
};
