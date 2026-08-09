// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";

import {
  isPersonalBetaSubjectAllowed,
  PERSONAL_BETA_SUBJECTS_ENV,
} from "./personalBeta";

describe("personal beta subject allowlist", () => {
  it("matches only exact trimmed subjects", () => {
    const readEnvironment = (name: string) => {
      expect(name).toBe(PERSONAL_BETA_SUBJECTS_ENV);
      return " user_alice, user_bob ";
    };

    expect(isPersonalBetaSubjectAllowed("user_alice", readEnvironment)).toBe(
      true
    );
    expect(isPersonalBetaSubjectAllowed("user_al", readEnvironment)).toBe(
      false
    );
    expect(isPersonalBetaSubjectAllowed("*", readEnvironment)).toBe(false);
  });

  it.each([undefined, "", "   ", ", ,"])(
    "denies missing or empty configuration (%s)",
    (configuredSubjects) => {
      expect(
        isPersonalBetaSubjectAllowed("user_alice", () => configuredSubjects)
      ).toBe(false);
    }
  );

  it("denies access when the environment is unavailable", () => {
    expect(
      isPersonalBetaSubjectAllowed("user_alice", () => {
        throw new Error("environment unavailable");
      })
    ).toBe(false);
  });
});
