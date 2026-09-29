/**
 * Minimal supplementary types for the employer membership tables the
 * frontend reads to resolve which hiring team the signed-in employer belongs
 * to. This mirrors the pattern of `src/types/json-fields.ts`: the generated
 * `Database` type is not edited here, so this file cannot drift into
 * re-declaring the schema — it only carries the two columns the resolver
 * actually selects, with the shapes the live migration defines.
 */
export type EmployerMembershipRow = {
  org_id: string;
  role: "owner" | "admin" | "recruiter" | "viewer" | string;
};

export type EmployerOrganizationRow = {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
};

/** The only query shape the resolver uses, kept narrow on purpose. */
export type MembershipSelectResult = {
  data: EmployerMembershipRow[] | null;
  error: { message: string } | null;
};

export type MembershipQuery = PromiseLike<MembershipSelectResult>;

export type MembershipReadable = {
  from: (table: "employer_members") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        limit: (count: number) => MembershipQuery;
      };
    };
  };
};
