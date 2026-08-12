/**
 * Master Admin Portal — platform visibility core (Stage 2 §8).
 * Service catalogue insights: services available but not used, services
 * requiring verification, and a coverage indicator (verified providers per
 * service). Read-only, sb_admin only, RLS via asUser.
 */
import type { Sql } from "postgres";

export type AdminServiceInsightRow = {
  serviceId: string;
  serviceName: string;
  categoryName: string | null;
  providers: { companyId: string; companyName: string; verificationStatus: string }[];
  verifiedProviders: number;
  activeDemand: number;
  coverage: "low" | "adequate";
};

export type AdminServiceInsights = {
  availableNotUsed: { serviceId: string; serviceName: string; categoryName: string | null }[];
  requiringVerification: {
    companyId: string; companyName: string; serviceId: string; serviceName: string;
    source: string; confidence: string | null;
  }[];
  rows: AdminServiceInsightRow[];
};

export async function doGetAdminServiceInsights(tx: Sql): Promise<AdminServiceInsights> {
  const [cats, rels] = await Promise.all([
    tx`select s.id as service_id, s.name as service_name, sc.name as category_name
       from services s
       left join service_categories sc on sc.id = s.category_id
       order by s.name asc`,
    tx`select cs.company_id, c.name as company_name, cs.service_id,
              cs.source, cs.confidence, cs.verification_status
       from company_services cs
       join companies c on c.id = cs.company_id
       order by c.name asc`,
  ]);
  const relArr = rels as unknown as {
    company_id: string; company_name: string; service_id: string;
    source: string; confidence: string | null; verification_status: string;
  }[];
  const rows: AdminServiceInsightRow[] = (cats as unknown as {
    service_id: string; service_name: string; category_name: string | null;
  }[]).map((svc) => {
    const rel = relArr.filter((r) => r.service_id === svc.service_id);
    const verified = rel.filter((r) => r.verification_status === "Verified").length;
    return {
      serviceId: svc.service_id,
      serviceName: svc.service_name,
      categoryName: svc.category_name,
      providers: rel.map((r) => ({
        companyId: r.company_id,
        companyName: r.company_name,
        verificationStatus: r.verification_status,
      })),
      verifiedProviders: verified,
      activeDemand: rel.length,
      coverage: verified >= 2 ? "adequate" : "low",
    };
  });
  return {
    availableNotUsed: rows.filter((r) => r.providers.length === 0).map((r) => ({
      serviceId: r.serviceId, serviceName: r.serviceName, categoryName: r.categoryName,
    })),
    requiringVerification: rows.flatMap((r) =>
      r.providers.filter((p) => p.verificationStatus === "Pending").map((p) => {
        const rel = relArr.find((x) => x.company_id === p.companyId && x.service_id === r.serviceId)!;
        return {
          companyId: p.companyId, companyName: p.companyName, serviceId: r.serviceId,
          serviceName: r.serviceName, source: rel.source, confidence: rel.confidence,
        };
      }),
    ),
    rows,
  };
}
