"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import {
  ArrowLeft,
  Phone,
  Mail,
  Car,
  ClipboardList,
  MessageSquare,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useCollection, where } from "@/lib/useCollection";
import { Customer, Vehicle, JobCard, JOB_STATUS_META } from "@/lib/models";
import { initials, formatDate, formatMoney } from "@/lib/format";
import { CenterSpinner, EmptyState, Badge } from "@/components/ui";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  const { data: vehicles } = useCollection<Vehicle>("vehicles", [
    where("customerId", "==", id),
  ]);
  const { data: jobs } = useCollection<JobCard>("jobCards", [
    where("customerId", "==", id),
  ]);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "customers", id));
      if (snap.exists()) setCustomer(snap.data() as Customer);
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <CenterSpinner label="Loading customer…" />;
  if (!customer)
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="Customer not found" hint="It may have been archived." />
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={() => router.push("/dashboard/customers")}
        className="mb-6 flex items-center gap-2 font-sans text-sm text-ink-soft transition hover:text-burgundy-600"
      >
        <ArrowLeft size={16} /> All customers
      </button>

      {/* Profile header */}
      <div className="card mb-6 p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-rosegold-sheen font-serif text-2xl font-semibold text-white shadow-luxe">
            {initials(customer.displayName)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-3xl font-semibold text-burgundy-700">
                {customer.displayName}
              </h1>
              {customer.segment && customer.segment !== "walkin" && (
                <Badge tone={customer.segment === "vip" ? "gold" : "blue"}>
                  {customer.segment.toUpperCase()}
                </Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-sans text-sm text-ink-soft">
              <span className="flex items-center gap-1.5">
                <Phone size={14} /> {customer.phone}
              </span>
              {customer.email && (
                <span className="flex items-center gap-1.5">
                  <Mail size={14} /> {customer.email}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <MessageSquare size={14} /> Prefers{" "}
                {customer.preferredChannel === "sms"
                  ? "SMS"
                  : customer.preferredChannel === "whatsapp"
                  ? "WhatsApp"
                  : "Email"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Vehicles */}
      <section className="mb-6">
        <h2 className="mb-3 flex items-center gap-2 font-serif text-xl font-semibold text-ink">
          <Car size={20} className="text-rosegold-500" /> Vehicles
        </h2>
        {vehicles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-surface-muted/40 px-5 py-8 text-center font-sans text-sm text-ink-soft">
            No vehicles on file for this customer yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {vehicles.map((v) => (
              <Link
                key={v.id}
                href={`/dashboard/vehicles/${v.id}`}
                className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-luxe"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-muted text-burgundy-500">
                  <Car size={18} />
                </div>
                <div>
                  <p className="font-sans font-medium text-ink">
                    {v.make} {v.model}
                    {v.year ? ` · ${v.year}` : ""}
                  </p>
                  <p className="font-sans text-xs uppercase tracking-wide text-ink-faint">
                    {v.plateNumber}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Job history */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-serif text-xl font-semibold text-ink">
          <ClipboardList size={20} className="text-rosegold-500" /> Job history
        </h2>
        {jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-surface-muted/40 px-5 py-8 text-center font-sans text-sm text-ink-soft">
            No jobs recorded yet.
          </div>
        ) : (
          <div className="space-y-2">
            {jobs
              .slice()
              .sort(
                (a, b) =>
                  (b.createdAt?.toMillis?.() ?? 0) -
                  (a.createdAt?.toMillis?.() ?? 0)
              )
              .map((j) => (
                <Link
                  key={j.id}
                  href={`/dashboard/job-cards/${j.id}`}
                  className="card flex items-center justify-between gap-3 p-4 transition-shadow hover:shadow-luxe"
                >
                  <div className="min-w-0">
                    <p className="truncate font-sans font-medium text-ink">
                      {j.complaint || "Job card"}
                    </p>
                    <p className="font-sans text-xs text-ink-faint">
                      {formatDate(j.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-sans text-sm font-medium text-ink">
                      {formatMoney(j.totalMinor)}
                    </span>
                    <Badge tone={JOB_STATUS_META[j.status]?.tone ?? "neutral"}>
                      {JOB_STATUS_META[j.status]?.label ?? j.status}
                    </Badge>
                  </div>
                </Link>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
