/**
 * Is the Storage API's upload path working on this local stack?
 *
 * Independent of the app: mints a throwaway local user, signs in, and PUTs a
 * tiny object straight at the storage API. The point is to answer one question
 * -- does the platform work -- without the application in the way, so a failure
 * is unambiguously the stack rather than a route.
 */
import { createServerClient } from "@supabase/ssr";

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const email = `storage-probe-${Date.now()}@example.com`;
const password = "Storage-Probe-Pass-1";

const created = await fetch(`${SUPA}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!created.ok) {
  console.error(`could not create the probe user: ${created.status} ${await created.text()}`);
  process.exit(1);
}
const { id: userId } = await created.json();

const store = new Map();
const client = createServerClient(SUPA, PUBLISHABLE, {
  cookies: {
    getAll: () => [...store].map(([name, value]) => ({ name, value })),
    setAll: (list) => { for (const { name, value } of list) store.set(name, value); },
  },
});
const { data, error } = await client.auth.signInWithPassword({ email, password });
if (error) {
  console.error(`sign in failed: ${error.message}`);
  process.exit(1);
}

const path = `${userId}/probe-${Date.now()}.pdf`;
const res = await fetch(`${SUPA}/storage/v1/object/resumes/${path}`, {
  method: "POST",
  headers: {
    apikey: PUBLISHABLE,
    Authorization: `Bearer ${data.session.access_token}`,
    "Content-Type": "application/pdf",
  },
  body: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]),
});

const text = await res.text();
console.log(`\n  storage-api upload to the caller's own folder: ${res.status}`);
console.log(`  ${text.slice(0, 400)}\n`);

if (res.ok) {
  const list = await fetch(
    `${SUPA}/rest/v1/storage.objects?bucket_id=eq.resumes&name=eq.${encodeURIComponent(path)}&select=name,owner_id`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  const rows = await list.json();
  console.log(`  the object is a real row: ${Array.isArray(rows) && rows.length === 1} ${JSON.stringify(rows)}`);
  process.exit(0);
}

console.log("  FAILED: the storage-api cannot insert into storage.objects on this stack.");
process.exit(1);
