"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Car,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Plus,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { auth, db } from "@/lib/firebase";
import { useCollection } from "@/lib/useCollection";
import {
  Customer,
  JobCard,
  JobStatus,
  JOB_STATUS_META,
  JOB_STATUS_ORDER,
  ServiceType,
  Vehicle,
} from "@/lib/models";
import { formatDate, formatMoney } from "@/lib/format";
import {
  Badge,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SearchInput,
  TableSkeleton,
  useToast,
} from "@/components/ui";

type StaffMember = {
  id: string;
  role?: string;
  displayName?: string;
  email?: string;
  archived?: boolean;
};

type StatusFilter = "all" | Exclude<JobStatus, "delivered">;
type SortOption = "newest" | "oldest" | "due";

const ACTIVE_STATUSES = JOB_STATUS_ORDER.filter(
  (status): status is Exclude<JobStatus, "delivered"> => status !== "delivered",
);

const STATUS_STYLES: Record<Exclude<JobStatus, "delivered">, {
  dot: string;
  accent: string;
  selected: string;
}> = {
  booked: {
    dot: "bg-slate-400",
    accent: "bg-slate-400",
    selected: "border-slate-300 bg-slate-50 text-slate-800",
  },
  in_progress: {
    dot: "bg-sky-500",
    accent: "bg-sky-500",
    selected: "border-sky-300 bg-sky-50 text-sky-800",
  },
  awaiting_parts: {
    dot: "bg-amber-500",
    accent: "bg-amber-500",
    selected: "border-amber-300 bg-amber-50 text-amber-800",
  },
  qc: {
    dot: "bg-violet-500",
    accent: "bg-violet-500",
    selected: "border-violet-300 bg-violet-50 text-violet-800",
  },
  ready: {
    dot: "bg-emerald-500",
    accent: "bg-emerald-500",
    selected: "border-emerald-300 bg-emerald-50 text-emerald-800",
  },
};

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function isPastDate(value: string) {
  if (!value) return false;
  const selected = new Date(value);
  selected.setHours(0, 0, 0, 0);
  return selected < startOfToday();
}

export default function JobCardsPage() {
  const { branchId, role } = useAuth();
  const router = useRouter();
  const { notify } = useToast();
  const today = new Date().toISOString().split("T")[0];

  const { data: allJobs, loading, error } = useCollection<JobCard>("jobCards");
  const { data: customers } = useCollection<Customer>("customers");
  const { data: vehicles } = useCollection<Vehicle>("vehicles");
  const { data: services } = useCollection<ServiceType>("services");
  const { data: staff } = useCollection<StaffMember>("users");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedTechnicians, setSelectedTechnicians] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [promisedDate, setPromisedDate] = useState("");

  const canCreate = role === "owner" || role === "manager" || role === "advisor";
  const availableTechnicians = staff.filter(
    (member) => member.role === "technician" && !member.archived,
  );

  const jobs = useMemo(
    () =>
      allJobs.filter((job) => {
        if (job.archived || job.status === "delivered") return false;
        if (role !== "technician") return true;
        return (job.assignedTechnicianIds ?? []).includes(
          auth.currentUser?.uid ?? "",
        );
      }),
    [allJobs, role],
  );

  const customerName = (customerId: string) =>
    customers.find((customer) => customer.id === customerId)?.displayName ?? "Unknown customer";

  const vehicleFor = (vehicleId: string) =>
    vehicles.find((vehicle) => vehicle.id === vehicleId);

  const serviceNames = (serviceIds: string[] = []) => {
    const names = services
      .filter((service) => serviceIds.includes(service.id))
      .map((service) => service.name);
    return names.length > 0 ? names.join(", ") : "No service selected";
  };

  const technicianNames = (technicianIds: string[] = []) => {
    const names = staff
      .filter((member) => technicianIds.includes(member.id))
      .map((member) => member.displayName || member.email || "Technician");
    return names.length > 0 ? names.join(", ") : "Unassigned";
  };

  const modalVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.customerId === selectedCustomer),
    [selectedCustomer, vehicles],
  );

  const searchedJobs = useMemo(() => {
    const queryValue = search.toLowerCase().trim();
    if (!queryValue) return jobs;

    return jobs.filter((job) => {
      const vehicle = vehicleFor(job.vehicleId);
      return (
        job.complaint?.toLowerCase().includes(queryValue) ||
        customerName(job.customerId).toLowerCase().includes(queryValue) ||
        vehicle?.plateNumber?.toLowerCase().includes(queryValue) ||
        vehicle?.make?.toLowerCase().includes(queryValue) ||
        vehicle?.model?.toLowerCase().includes(queryValue) ||
        serviceNames(job.serviceTypeIds).toLowerCase().includes(queryValue) ||
        technicianNames(job.assignedTechnicianIds).toLowerCase().includes(queryValue)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, jobs, search, services, staff, vehicles]);

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(
      ACTIVE_STATUSES.map((status) => [status, 0]),
    ) as Record<Exclude<JobStatus, "delivered">, number>;
    searchedJobs.forEach((job) => {
      if (job.status !== "delivered") counts[job.status] += 1;
    });
    return counts;
  }, [searchedJobs]);

  const filteredJobs = useMemo(() => {
    const rows = searchedJobs.filter(
      (job) => statusFilter === "all" || job.status === statusFilter,
    );

    return rows.slice().sort((left, right) => {
      if (sortBy === "oldest") {
        return (left.createdAt?.toMillis?.() ?? 0) - (right.createdAt?.toMillis?.() ?? 0);
      }
      if (sortBy === "due") {
        const leftDue = left.promisedEndDate?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
        const rightDue = right.promisedEndDate?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
        return leftDue - rightDue;
      }
      return (right.createdAt?.toMillis?.() ?? 0) - (left.createdAt?.toMillis?.() ?? 0);
    });
  }, [searchedJobs, sortBy, statusFilter]);

  const overdueCount = jobs.filter(
    (job) => job.promisedEndDate && job.promisedEndDate.toDate() < startOfToday(),
  ).length;
  const dueTodayCount = jobs.filter((job) => {
    if (!job.promisedEndDate) return false;
    const due = job.promisedEndDate.toDate();
    const todayStart = startOfToday();
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return due >= todayStart && due < tomorrow;
  }).length;
  const unassignedCount = jobs.filter(
    (job) => (job.assignedTechnicianIds ?? []).length === 0,
  ).length;

  const technicianJobCount = (technicianId: string) =>
    jobs.filter((job) => job.assignedTechnicianIds?.includes(technicianId)).length;

  function calculatePromisedDate(date: string) {
    if (!date || selectedServices.length === 0) return "";
    const totalDays = selectedServices.reduce((total, serviceId) => {
      const service = services.find((item) => item.id === serviceId);
      return total + (service?.estimatedDays ?? 0);
    }, 0);
    const promised = new Date(date);
    promised.setDate(promised.getDate() + totalDays);
    return promised.toISOString().split("T")[0];
  }

  useEffect(() => {
    if (startDate) setPromisedDate(calculatePromisedDate(startDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServices, startDate]);

  function resetCreateForm() {
    setModalOpen(false);
    setSelectedCustomer("");
    setSelectedVehicle("");
    setSelectedServices([]);
    setSelectedTechnicians([]);
    setStartDate("");
    setPromisedDate("");
  }

  async function handleCreate(form: FormData) {
    if (!branchId) return;

    const start = String(form.get("startDate") || "");
    const promised = String(form.get("promisedEndDate") || "");
    const scheduled = String(form.get("scheduledDate") || "");
    const complaint = String(form.get("complaint") || "").trim();

    if ([start, promised, scheduled].some(isPastDate)) {
      notify("Job dates cannot be in the past.", "error");
      return;
    }
    if (start && promised && new Date(promised) < new Date(start)) {
      notify("Promised end date cannot be before the start date.", "error");
      return;
    }
    if (
      !selectedCustomer ||
      !selectedVehicle ||
      !complaint ||
      selectedServices.length === 0
    ) {
      notify("Customer, vehicle, service and complaint are required.", "error");
      return;
    }

    setSaving(true);
    try {
      const batch = writeBatch(db);
      const jobRef = doc(collection(db, "jobCards"));
      const createdByUid = auth.currentUser?.uid ?? "unknown";

      batch.set(jobRef, {
        branchId,
        customerId: selectedCustomer,
        vehicleId: selectedVehicle,
        complaint,
        serviceTypeIds: selectedServices,
        assignedTechnicianIds: selectedTechnicians,
        startDate: start ? Timestamp.fromDate(new Date(start)) : null,
        promisedEndDate: promised ? Timestamp.fromDate(new Date(promised)) : null,
        scheduledDate: scheduled ? Timestamp.fromDate(new Date(scheduled)) : null,
        status: "booked" as JobStatus,
        subtotalMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
        invoiceId: null,
        archived: false,
        createdByUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      services
        .filter((service) => selectedServices.includes(service.id))
        .forEach((service) => {
          const lineRef = doc(collection(db, "jobCardLines"));
          batch.set(lineRef, {
            branchId,
            jobCardId: jobRef.id,
            kind: "labor",
            serviceTypeId: service.id,
            description: service.name,
            quantity: 1,
            unitPriceMinor: service.defaultPriceMinor,
            lineTotalMinor: service.defaultPriceMinor,
            archived: false,
            createdByUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

      await batch.commit();
      notify("Job card created with service labor lines.");
      resetCreateForm();
      router.push(`/dashboard/job-cards/${jobRef.id}`);
    } catch (createError) {
      console.error(createError);
      notify("Could not create job card.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Operations"
        title="Job Cards"
        icon={ClipboardList}
        action={
          canCreate && (
            <button onClick={() => setModalOpen(true)} className="btn-primary">
              <Plus size={18} /> New Job
            </button>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={ClipboardList} label="Active jobs" value={jobs.length} tone="burgundy" />
        <SummaryCard icon={CalendarClock} label="Due today" value={dueTodayCount} tone="blue" />
        <SummaryCard icon={AlertTriangle} label="Overdue" value={overdueCount} tone="amber" />
        <SummaryCard icon={Users} label="Unassigned" value={unassignedCount} tone="neutral" />
      </div>

      <div className="mb-5 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="Filter job cards by status">
            <StatusFilterButton
              active={statusFilter === "all"}
              label="All active"
              count={searchedJobs.length}
              onClick={() => setStatusFilter("all")}
            />
            {ACTIVE_STATUSES.map((status) => (
              <StatusFilterButton
                key={status}
                active={statusFilter === status}
                label={JOB_STATUS_META[status].label}
                count={statusCounts[status]}
                dotClass={STATUS_STYLES[status].dot}
                activeClass={STATUS_STYLES[status].selected}
                onClick={() => setStatusFilter(status)}
              />
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search job, vehicle, customer…"
              className="w-full sm:w-72"
            />
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortOption)}
              className="input-luxe min-w-36 text-sm"
              aria-label="Sort job cards"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="due">Due date</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-burgundy-50 px-4 py-3 text-sm text-burgundy-600">
          {error}
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={5} rows={6} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No active job cards"
          hint="Open a job card when a vehicle comes in for work."
          action={
            canCreate && (
              <button onClick={() => setModalOpen(true)} className="btn-primary">
                <Plus size={18} /> New Job
              </button>
            )
          }
        />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No matching job cards"
          hint="Try another search term or status filter."
          action={
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
              }}
              className="btn-ghost"
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1 text-xs text-ink-faint">
            <span>{filteredJobs.length} job{filteredJobs.length === 1 ? "" : "s"} shown</span>
            <span>Select a row to open its full job card</span>
          </div>
          {filteredJobs.map((job) => (
            <JobRegisterRow
              key={job.id}
              job={job}
              customerName={customerName(job.customerId)}
              vehicle={vehicleFor(job.vehicleId)}
              services={serviceNames(job.serviceTypeIds)}
              technicians={technicianNames(job.assignedTechnicianIds)}
            />
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={resetCreateForm} title="New Job Card" size="lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate(new FormData(event.currentTarget));
          }}
          className="max-h-[75vh] space-y-5 overflow-y-auto pr-2"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Customer" required>
              <select
                name="customerId"
                value={selectedCustomer}
                onChange={(event) => {
                  setSelectedCustomer(event.target.value);
                  setSelectedVehicle("");
                }}
                className="input-luxe"
              >
                <option value="" disabled>Select a customer…</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName} · {customer.phone}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Vehicle"
              required
              hint={
                selectedCustomer && modalVehicles.length === 0
                  ? "No vehicle is registered for this customer."
                  : undefined
              }
            >
              <select
                name="vehicleId"
                value={selectedVehicle}
                onChange={(event) => setSelectedVehicle(event.target.value)}
                disabled={!selectedCustomer}
                className="input-luxe"
              >
                <option value="" disabled>
                  {selectedCustomer ? "Select a vehicle…" : "Pick a customer first"}
                </option>
                {modalVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.make} {vehicle.model} · {vehicle.plateNumber}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <fieldset>
            <legend className="label-luxe">Services <span className="text-rosegold-500">*</span></legend>
            <div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-line bg-surface-muted/30 p-3 sm:grid-cols-2">
              {services.filter((service) => service.active).map((service) => {
                const selected = selectedServices.includes(service.id);
                return (
                  <label
                    key={service.id}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition ${
                      selected
                        ? "border-burgundy-300 bg-burgundy-50 text-burgundy-700"
                        : "border-line bg-white text-ink-soft hover:border-burgundy-200"
                    }`}
                  >
                    <span>
                      <span className="font-medium">{service.name}</span>
                      <span className="ml-2 text-xs text-ink-faint">{service.estimatedDays}d</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        setSelectedServices((current) =>
                          selected
                            ? current.filter((serviceId) => serviceId !== service.id)
                            : [...current, service.id],
                        )
                      }
                      className="h-4 w-4 accent-burgundy-600"
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label-luxe">Technicians</legend>
            <div className="grid max-h-40 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-line bg-surface-muted/30 p-3 sm:grid-cols-2">
              {availableTechnicians.length === 0 ? (
                <p className="col-span-full py-3 text-center text-sm text-ink-soft">No technician accounts available.</p>
              ) : (
                availableTechnicians.map((technician) => {
                  const selected = selectedTechnicians.includes(technician.id);
                  return (
                    <label
                      key={technician.id}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition ${
                        selected
                          ? "border-burgundy-300 bg-burgundy-50 text-burgundy-700"
                          : "border-line bg-white text-ink-soft hover:border-burgundy-200"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {technician.displayName || technician.email}
                        </span>
                        <span className="text-xs text-ink-faint">
                          {technicianJobCount(technician.id)} active job{technicianJobCount(technician.id) === 1 ? "" : "s"}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setSelectedTechnicians((current) =>
                            selected
                              ? current.filter((technicianId) => technicianId !== technician.id)
                              : [...current, technician.id],
                          )
                        }
                        className="h-4 w-4 accent-burgundy-600"
                      />
                    </label>
                  );
                })
              )}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Start date">
              <input
                name="startDate"
                type="date"
                min={today}
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="input-luxe"
              />
            </Field>
            <Field label="Promised end">
              <input
                name="promisedEndDate"
                type="date"
                min={startDate || today}
                value={promisedDate}
                onChange={(event) => setPromisedDate(event.target.value)}
                className="input-luxe"
              />
            </Field>
            <Field label="Scheduled date" hint="Optional">
              <input name="scheduledDate" type="date" min={today} className="input-luxe" />
            </Field>
          </div>

          <Field label="Complaint / work requested" required>
            <textarea
              name="complaint"
              rows={3}
              className="input-luxe resize-none"
              placeholder="Describe the customer complaint and requested work…"
            />
          </Field>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={resetCreateForm} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Creating…" : "Create job card"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: "burgundy" | "blue" | "amber" | "neutral";
}) {
  const tones = {
    burgundy: "bg-burgundy-50 text-burgundy-600",
    blue: "bg-sky-50 text-sky-600",
    amber: "bg-amber-50 text-amber-600",
    neutral: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon size={19} />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none text-ink">{value}</p>
        <p className="mt-1 text-xs text-ink-soft">{label}</p>
      </div>
    </div>
  );
}

function StatusFilterButton({
  active,
  label,
  count,
  dotClass,
  activeClass = "border-burgundy-300 bg-burgundy-50 text-burgundy-700",
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  dotClass?: string;
  activeClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
        active
          ? activeClass
          : "border-line bg-white text-ink-soft hover:border-burgundy-200 hover:text-ink"
      }`}
    >
      {dotClass && <span className={`h-2 w-2 rounded-full ${dotClass}`} />}
      <span>{label}</span>
      <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold shadow-xs">
        {count}
      </span>
    </button>
  );
}

function JobRegisterRow({
  job,
  customerName,
  vehicle,
  services,
  technicians,
}: {
  job: JobCard & { id: string };
  customerName: string;
  vehicle?: Vehicle & { id: string };
  services: string;
  technicians: string;
}) {
  const status = job.status as Exclude<JobStatus, "delivered">;
  const overdue = !!job.promisedEndDate && job.promisedEndDate.toDate() < startOfToday();

  return (
    <Link
      href={`/dashboard/job-cards/${job.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-line bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-burgundy-200 hover:shadow-luxe focus:outline-none focus:ring-2 focus:ring-burgundy-300"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${STATUS_STYLES[status].accent}`} />
      <div className="p-4 pl-5 sm:p-5 sm:pl-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={JOB_STATUS_META[job.status].tone}>{JOB_STATUS_META[job.status].label}</Badge>
              {overdue && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                  <AlertTriangle size={12} /> Overdue
                </span>
              )}
              {job.invoiceId && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  Invoiced
                </span>
              )}
            </div>
            <h2 className="mt-2 line-clamp-1 text-base font-semibold text-ink transition group-hover:text-burgundy-600">
              {job.complaint}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-faint">
              <Clock3 size={12} /> Opened {formatDate(job.createdAt)}
            </p>
          </div>

          <div className="grid min-w-0 flex-[2] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <JobDetail icon={Car} label="Vehicle">
              <span className="font-medium text-ink">
                {vehicle ? `${vehicle.make} ${vehicle.model}` : "Unknown vehicle"}
              </span>
              {vehicle?.plateNumber && (
                <span className="ml-1.5 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide text-white">
                  {vehicle.plateNumber}
                </span>
              )}
            </JobDetail>
            <JobDetail icon={User} label="Customer">{customerName}</JobDetail>
            <JobDetail icon={Wrench} label="Services">{services}</JobDetail>
            <JobDetail icon={Users} label="Technicians">{technicians}</JobDetail>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-5 border-t border-line pt-3 xl:w-44 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Due</p>
              <p className={`mt-1 text-xs font-medium ${overdue ? "text-red-700" : "text-ink-soft"}`}>
                {job.promisedEndDate ? formatDate(job.promisedEndDate) : "Not set"}
              </p>
              <p className="mt-2 text-sm font-bold text-ink">{formatMoney(job.totalMinor)}</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-burgundy-50 text-burgundy-600 transition group-hover:bg-burgundy-600 group-hover:text-white">
              <ArrowRight size={17} />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function JobDetail({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-muted/45 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        <Icon size={11} /> {label}
      </p>
      <div className="mt-1 truncate text-xs text-ink-soft">{children}</div>
    </div>
  );
}
