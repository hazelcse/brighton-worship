import "server-only";

/** The password every member account starts with. Members must change it on first login. */
export function defaultMemberPassword(): string {
  const value = process.env.DEFAULT_MEMBER_PASSWORD;
  if (!value || value.length < 6) {
    throw new Error("Set DEFAULT_MEMBER_PASSWORD (at least 6 characters) in web/.env.local.");
  }
  return value;
}
