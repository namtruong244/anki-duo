export interface Env {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
  BETTER_AUTH_SECRET?: string | undefined;
  BETTER_AUTH_URL?: string | undefined;
  ORIGIN_SECRET?: string | undefined;
  ORIGIN_SECRET_PREVIOUS?: string | undefined;
  R2_ENDPOINT?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  R2_BUCKET?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
}
