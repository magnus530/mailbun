// Copy this file to `credentials.ts` (gitignored) and fill in the OAuth
// client IDs you registered with Google / Microsoft.
//
// credentials.ts is baked into packaged release builds so end users never
// need a .env file. In dev (`npm run electron:dev`) the server still reads
// .env, so this is only required when producing a distributable build.
export const bakedCredentials: Record<string, string> = {
  GOOGLE_OAUTH_CLIENT_ID: "",
  GOOGLE_OAUTH_CLIENT_SECRET: "",
  MICROSOFT_OAUTH_CLIENT_ID: "",
};
