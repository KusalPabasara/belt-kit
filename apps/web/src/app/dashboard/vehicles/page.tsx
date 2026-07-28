"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Car, Plus, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/useCollection";
import { createDoc, updateDocById, deleteDocById } from "@/lib/db-write";
import { Vehicle, Customer } from "@/lib/models";
import {
  PageHeader,
  Modal,
  Field,
  CenterSpinner,
  TableSkeleton,
  EmptyState,
  ConfirmDialog,
  DataTable,
  Column,
  SearchInput,
  useToast,
} from "@/components/ui";

function VehiclesInner() {
  const { branchId, role } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const preselectCustomer = params.get("customer");

  const { data: vehicles, loading, error } = useCollection<Vehicle>("vehicles");
  const { data: customers } = useCollection<Customer>("customers");
  const { notify } = useToast();

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<(Vehicle & { id: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = role === "owner" || role === "manager" || role === "advisor";
  const validateYear = (year:number) => {
  const currentYear = new Date().getFullYear();

  return (
    year.toString().length === 4 &&
    year <= currentYear
  );
};

const validateRequiredText = (value:string) => {
  return value.trim().length > 0;
};
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function doDelete(id: string) {
    try {
      await deleteDocById("vehicles", id);
      notify("Vehicle deleted.");
    } catch {
      notify("Could not delete vehicle.", "error");
    }
  }

  useEffect(() => {
    if (preselectCustomer) {
      setEditing(null);
      setModalOpen(true);
    }
  }, [preselectCustomer]);

  const customerName = (cid: string) =>
    customers.find((c) => c.id === cid)?.displayName ?? "Unknown owner";

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return vehicles;
    return vehicles.filter(
      (v) =>
        v.plateNumber?.toLowerCase().includes(q) ||
        v.make?.toLowerCase().includes(q) ||
        v.model?.toLowerCase().includes(q) ||
        customerName(v.customerId).toLowerCase().includes(q)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, search, customers]);

  const columns: Column<Vehicle & { id: string }>[] = [
    {
      key: "vehicle",
      header: "Vehicle",
      sortValue: (v) => `${v.make} ${v.model}`.toLowerCase(),
      cell: (v) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-burgundy-500">
            <Car size={17} />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink group-hover:text-burgundy-600">
              {v.make} {v.model}
            </p>
            {v.year && <p className="text-xs text-ink-faint">{v.year}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "plate",
      header: "Plate",
      sortValue: (v) => v.plateNumber ?? "",
      cell: (v) => (
        <span className="inline-block rounded-md bg-burgundy-deep px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-white">
          {v.plateNumber}
        </span>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      sortValue: (v) => customerName(v.customerId).toLowerCase(),
      hideBelow: "sm",
      cell: (v) => <span className="text-ink-soft">{customerName(v.customerId)}</span>,
    },
    {
      key: "vin",
      header: "VIN",
      hideBelow: "lg",
      cell: (v) => (
        <span className="text-xs text-ink-faint">{v.vin || "—"}</span>
      ),
    },
  ];

  async function handleSave(form: FormData) {
    if (!branchId) return;
    setSaving(true);
    const payload = {
      customerId: String(form.get("customerId") || ""),
      plateNumber: String(form.get("plateNumber") || "").trim().toUpperCase(),
      make: String(form.get("make") || "").trim(),
      model: String(form.get("model") || "").trim(),
      year: Number(form.get("year")),
vin: String(form.get("vin") || "").trim(),
engine: String(form.get("engine") || "").trim(),
    };
    if (
  !payload.customerId ||
  !payload.plateNumber ||
  !payload.make ||
  !payload.model ||
  !payload.engine ||
  !payload.vin ||
  !payload.year
) {
  notify(
    "Owner, plate, make, model, year, VIN and engine number are required.",
    "error"
  );

  setSaving(false);
  return;
}


if (!validateYear(payload.year)) {
  notify(
    "Year must contain 4 digits and cannot be greater than current year.",
    "error"
  );

  setSaving(false);
  return;
}
    try {
      if (editing) {
        await updateDocById("vehicles", editing.id, payload);
        notify("Vehicle updated.");
      } else {
        await createDoc("vehicles", branchId, payload);
        notify("Vehicle added.");
      }
      setModalOpen(false);
    } catch {
      notify("Could not save vehicle.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Records"
        title="Vehicles"
        icon={Car}
        action={
          canEdit && (
            <button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
              className="btn-primary"
            >
              <Plus size={18} /> New Vehicle
            </button>
          )
        }
      />

      <div className="mb-5">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search plate, make, model or owner…"
          className="w-full sm:max-w-md"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-burgundy-50 px-4 py-3 font-sans text-sm text-burgundy-600">
          {error}
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={4} />
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          initialSort={{ key: "vehicle", dir: "asc" }}
          onRowClick={(v) => router.push(`/dashboard/vehicles/${v.id}`)}
          rowActions={
            canEdit
              ? (v) => (
                  <>
                    <button
                      onClick={() => {
                        setEditing(v);
                        setModalOpen(true);
                      }}
                      className="rounded-lg p-2 text-ink-faint transition hover:bg-surface-muted hover:text-burgundy-600"
                      aria-label="Edit"
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => setDeleteId(v.id)}
                      className="rounded-lg p-2 text-ink-faint transition hover:bg-surface-muted hover:text-burgundy-600"
                      aria-label="Delete"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )
              : undefined
          }
          emptyState={
            <EmptyState
              icon={Car}
              title={search ? "No matches" : "No vehicles yet"}
              hint={
                search
                  ? "Try another search."
                  : "Add a vehicle and link it to a customer."
              }
            />
          }
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Vehicle" : "New Vehicle"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave(new FormData(e.currentTarget));
          }}
          className="space-y-4"
        >
          <Field label="Owner (customer)" required>
            <select
              name="customerId"
              defaultValue={editing?.customerId ?? preselectCustomer ?? ""}
              className="input-luxe"
            >
              <option value="" disabled>
                Select a customer…
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} · {c.phone}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Plate number" required>
              <input
                name="plateNumber"
                defaultValue={editing?.plateNumber}
                className="input-luxe uppercase"
                placeholder="e.g. CAB-1234"
              />
            </Field>
            <Field label="Year" required>
<input
  name="year"
  type="number"
  min="1900"
  max={new Date().getFullYear()}
  defaultValue={editing?.year}
  className="input-luxe"
  placeholder="2019"
/>
</Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Make" required>
              <input
                name="make"
                defaultValue={editing?.make}
                className="input-luxe"
                placeholder="Toyota"
              />
            </Field>
            <Field label="Model" required>
              <input
                name="model"
                defaultValue={editing?.model}
                className="input-luxe"
                placeholder="Aqua"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="VIN" required>
              <input
                name="vin"
                defaultValue={editing?.vin}
                className="input-luxe"
                
              />
            </Field>
            <Field label="Engine" required>
              <input
                name="engine"
                defaultValue={editing?.engine}
                className="input-luxe"
                
              />
            </Field>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : editing ? "Save changes" : "Add vehicle"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && doDelete(deleteId)}
        title="Delete this vehicle?"
        message="This permanently deletes the vehicle. Its past job cards are kept for history. This cannot be undone."
        confirmLabel="Delete permanently"
        danger
      />
    </div>
  );
}

export default function VehiclesPage() {
  return (
    <Suspense fallback={<CenterSpinner />}>
      <VehiclesInner />
    </Suspense>
  );
}
