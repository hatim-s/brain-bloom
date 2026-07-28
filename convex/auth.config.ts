/**
 * Connects Convex to Clerk's JWT issuer.
 *
 * Keyless development has no dashboard configuration: Clerk writes its
 * frontend API URL (which also acts as the issuer) to .env.local when it
 * provisions. The orchestrator supplies that value here; P9 adds production
 * configuration.
 */
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
