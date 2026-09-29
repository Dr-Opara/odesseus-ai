import type { EmployerProfile } from "../types";

/** DEV/TEST-ONLY FIXTURE — see gate in `../onboarding-adapter.ts`. */
export const EMPLOYER_PROFILE_FIXTURE: EmployerProfile = {
  id: "employer-1",
  companyName: "Acme Robotics",
  companyWebsite: "https://acme-robotics.example.com",
  industry: "Robotics",
  companySize: "51-200",
  description: "Autonomous warehouse robotics.",
  yourRole: "owner",
};
