/**
 * Connects Convex to Clerk's JWT issuer.
 *
 * Keyless/local runs have no issuer configured, so Convex auth remains
 * inactive and every `requireUser` call rejects. Set the issuer in the Convex
 * deployment environment when the Clerk instance is claimed in P9.
 */
const domain = process.env.CLERK_JWT_ISSUER_DOMAIN;

const authConfig = {
  providers: domain ? [{ domain, applicationID: "convex" }] : [],
};

export default authConfig;
