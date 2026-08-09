/**
 * Company profile server functions. Every query runs through asUser() so RLS
 * (companies.* policies scoped to app.user_id) is enforced on the database.
 */
import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";
import { asUser, dbConfigured, ensureSchema } from "./db";
import { auditQuery } from "./audit";
import { loadSessionUser } from "./auth-core";
import type { CompanyInput, PublicCompany } from "./types";

export type CompanyResult =
  | { ok: true; company: PublicCompany | null }
  | { ok: false; error: string; setupRequired?: boolean };

export const getMyCompany = createServerFn({ method: "GET" }).handler(
  async (): Promise<CompanyResult> => {
    if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
    try {
      await ensureSchema();
      const user = await loadSessionUser();
      if (!user) return { ok: false, error: "UNAUTHENTICATED" };
      const rows = (await asUser(user.id, user.role, (tx) => [
        tx`select id, name, type, description, contact_email, verification_status
           from companies where owner_id = ${user.id}`,
      ]))[1] as {
        id: string;
        name: string;
        type: string | null;
        description: string | null;
        contact_email: string | null;
        verification_status: PublicCompany["verificationStatus"];
      }[];
      const c = rows[0];
      if (!c) return { ok: true, company: null };
      return {
        ok: true,
        company: {
          id: c.id,
          name: c.name,
          type: c.type,
          description: c.description,
          contactEmail: c.contact_email,
          verificationStatus: c.verification_status,
        },
      };
    } catch (err) {
      console.error("getMyCompany failed:", err);
      return { ok: false, error: "Could not load your company profile." };
    }
  },
);

export const saveCompany = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as CompanyInput)
  .handler(async ({ data }): Promise<CompanyResult> => {
    if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
    const name = data.name.trim();
    const type = data.type.trim();
    const description = data.description.trim();
    const contactEmail = data.contactEmail.trim();
    if (!name) return { ok: false, error: "Company name is required." };
    if (contactEmail && !/^\S+@\S+\.\S+$/.test(contactEmail)) {
      return { ok: false, error: "Contact email is not valid." };
    }

    try {
      await ensureSchema();
      const user = await loadSessionUser();
      if (!user) return { ok: false, error: "UNAUTHENTICATED" };

      // Existing company id (the unique owner_id index makes this 0-or-1 rows).
      const existing = (await asUser(user.id, user.role, (tx) => [
        tx`select id from companies where owner_id = ${user.id}`,
      ]))[1] as { id: string }[];
      const companyId = existing[0]?.id ?? randomUUID();

      await asUser(user.id, user.role, (tx) => [
        tx`insert into companies
             (id, owner_id, name, type, description, contact_email, verification_status)
           values (${companyId}, ${user.id}, ${name}, ${type || null},
                   ${description || null}, ${contactEmail || null}, 'unverified')
           on conflict (owner_id) do update set
             name = excluded.name,
             type = excluded.type,
             description = excluded.description,
             contact_email = excluded.contact_email,
             updated_at = now()`,
        tx`update profiles set company_id = ${companyId}, updated_at = now()
           where user_id = ${user.id}`,
        auditQuery(tx, user.id, "company.upsert", { companyId, name }),
      ]);
      return {
        ok: true,
        company: {
          id: companyId,
          name,
          type: type || null,
          description: description || null,
          contactEmail: contactEmail || null,
          // Upserts never change verification status; it is controlled by the
          // (future) ScaleBridge verification workflow.
          verificationStatus: "unverified",
        },
      };
    } catch (err) {
      console.error("saveCompany failed:", err);
      return { ok: false, error: "Could not save your company profile. Please try again." };
    }
  });
