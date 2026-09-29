import type { EmployerNotification } from "../types";

/** DEV/TEST-ONLY FIXTURE — see gate in `../notifications-adapter.ts`. */
export const EMPLOYER_NOTIFICATION_FIXTURES: EmployerNotification[] = [
  {
    id: "notif-1",
    category: "new_applicant",
    title: "New applicant for Senior Backend Engineer",
    detail: "Alex Rivera applied 2 hours ago.",
    createdAt: "2026-09-27T14:00:00.000Z",
    read: false,
  },
  {
    id: "notif-2",
    category: "strong_fit",
    title: "Strong-fit candidate detected",
    detail: "Priya Sharma scored 91% Fit for Product Designer.",
    createdAt: "2026-09-27T09:00:00.000Z",
    read: false,
  },
  {
    id: "notif-3",
    category: "capacity_warning",
    title: "Approaching active job limit",
    detail: "2 of 3 active job slots used on the Starter plan.",
    createdAt: "2026-09-25T00:00:00.000Z",
    read: true,
  },
  {
    id: "notif-4",
    category: "pipeline_update",
    title: "Candidate moved to Interview",
    detail: "Sam Okafor moved to Interview for Senior Backend Engineer.",
    createdAt: "2026-09-24T00:00:00.000Z",
    read: true,
  },
];
