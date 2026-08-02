"use client";

import { useState, useMemo } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { Users, Plus, Phone, Mail, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/useCollection";
import { createDoc, updateDocById, deleteDocById } from "@/lib/db-write";
import { Customer } from "@/lib/models";
import { initials } from "@/lib/format";
import {
  PageHeader,
  Modal,
  Field,
  TableSkeleton,
  EmptyState,
  Badge,
  ConfirmDialog,
  DataTable,
  Column,
  FilterChips,
  SearchInput,
  useToast,
} from "@/components/ui";

const CHANNELS = ["sms", "whatsapp", "email"] as const;
const SEGMENTS = ["walkin", "vip", "fleet"] as const;

export default function CustomersPage() {
  const { branchId, role } = useAuth();
  const router = useRouter();
  const { data: customers, loading, error } = useCollection<Customer>("customers");
  const { notify } = useToast();

  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<(Customer & { id: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const canEdit = role === "owner" || role === "manager" || role === "advisor";

  const validateName = (name:string) => {
  return /^[A-Za-z\s]+$/.test(name);
};

const validatePhone = (phone:string) => {
  return /^[0-9]{10}$/.test(phone);
};

const validateEmail = (email:string) => {
  if (!email) return true; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

  async function doDelete(id: string) {
    try {
      // Delete the customer and cascade-delete their vehicles. Job cards are
      // KEPT for history (they'll just show no linked owner).
      const vehSnap = await getDocs(
        query(collection(db, "vehicles"), where("customerId", "==", id))
      );
      await Promise.all(
        vehSnap.docs.map((d) => deleteDocById("vehicles", d.id))
      );
      await deleteDocById("customers", id);
      notify("Customer and their vehicles deleted.");
    } catch {
      notify("Could not delete customer.", "error");
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let rows = customers;
    if (segment !== "all")
      rows = rows.filter((c) => (c.segment ?? "walkin") === segment);
    if (q)
      rows = rows.filter(
        (c) =>
          c.displayName?.toLowerCase().includes(q) ||
          c.phone?.includes(q) ||
          c.email?.toLowerCase().includes(q)
      );
    return rows;
  }, [customers, search, segment]);

  const segmentCounts = useMemo(() => {
    const c = { all: customers.length, walkin: 0, vip: 0, fleet: 0 };
    customers.forEach((x) => {
      const s = (x.segment ?? "walkin") as "walkin" | "vip" | "fleet";
      if (s in c) c[s]++;
    });
    return c;
  }, [customers]);

  const columns: Column<Customer & { id: string }>[] = [
    {
      key: "name",
      header: "Customer",
      sortValue: (c) => c.displayName?.toLowerCase() ?? "",
      cell: (c) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rosegold-sheen text-xs font-semibold text-white">
            {initials(c.displayName)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink group-hover:text-burgundy-600">
              {c.displayName}
            </p>
            {c.email && (
              <p className="flex items-center gap-1 truncate text-xs text-ink-faint">
                <Mail size={11} /> {c.email}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      sortValue: (c) => c.phone ?? "",
      hideBelow: "sm",
      cell: (c) => (
        <span className="flex items-center gap-1.5 text-ink-soft">
          <Phone size={13} className="text-ink-faint" /> {c.phone}
        </span>
      ),
    },
    {
      key: "segment",
      header: "Segment",
      sortValue: (c) => c.segment ?? "walkin",
      hideBelow: "md",
      cell: (c) => {
        const s = c.segment ?? "walkin";
        return s === "walkin" ? (
          <span className="text-xs text-ink-faint">Walk-in</span>
        ) : (
          <Badge tone={s === "vip" ? "gold" : "blue"}>{s.toUpperCase()}</Badge>
        );
      },
    },
  ];

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(c: Customer & { id: string }) {
    setEditing(c);
    setModalOpen(true);
  }

  async function handleSave(form: FormData) {
    if (!branchId) return;
    setSaving(true);
    const payload = {
      displayName: String(form.get("displayName") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
      email: String(form.get("email") || "").trim() || undefined,
      preferredChannel: String(form.get("preferredChannel") || "sms"),
      segment: String(form.get("segment") || "walkin"),
    };
    if (!payload.displayName || !payload.phone) {

  notify(
    "Name and phone are required.",
    "error"
  );

  setSaving(false);
  return;

}


if(!validateName(payload.displayName)){

  notify(
    "Name should contain only letters and spaces.",
    "error"
  );

  setSaving(false);
  return;

}


if(!validatePhone(payload.phone)){

  notify(
    "Phone number must contain exactly 10 digits.",
    "error"
  );

  setSaving(false);
  return;

}


if(!validateEmail(payload.email ?? "")){

  notify(
    "Please enter a valid email address.",
    "error"
  );

  setSaving(false);
  return;

}
    try {
      if (editing) {
        await updateDocById("customers", editing.id, payload);
        notify("Customer updated.");
      } else {
        await createDoc("customers", branchId, payload);
        notify("Customer added.");
      }
      setModalOpen(false);
    } catch {
      notify("Could not save. Check permissions / rules.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="CRM"
        title="Customers"
        icon={Users}
        action={
          canEdit && (
            <button onClick={openNew} className="btn-primary">
              <Plus size={18} /> New Customer
            </button>
          )
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          value={segment}
          onChange={setSegment}
          options={[
            { value: "all", label: "All", count: segmentCounts.all },
            { value: "walkin", label: "Walk-in", count: segmentCounts.walkin },
            { value: "vip", label: "VIP", count: segmentCounts.vip },
            { value: "fleet", label: "Fleet", count: segmentCounts.fleet },
          ]}
        />
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name, phone or email…"
          className="w-full sm:max-w-xs"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-burgundy-50 px-4 py-3 font-sans text-sm text-burgundy-600">
          {error}
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={3} />
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          initialSort={{ key: "name", dir: "asc" }}
          onRowClick={(c) => router.push(`/dashboard/customers/${c.id}`)}
          rowActions={
            canEdit
              ? (c) => (
                  <>
                    <button
                      onClick={() => openEdit(c)}
                      className="rounded-lg p-2 text-ink-faint transition hover:bg-surface-muted hover:text-burgundy-600"
                      aria-label="Edit"
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => setDeleteId(c.id)}
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
              icon={Users}
              title={search || segment !== "all" ? "No matches" : "No customers yet"}
              hint={
                search || segment !== "all"
                  ? "Try a different search or filter."
                  : "Add your first customer to start building service history."
              }
              action={
                canEdit &&
                !search &&
                segment === "all" && (
                  <button onClick={openNew} className="btn-primary">
                    <Plus size={18} /> New Customer
                  </button>
                )
              }
            />
          }
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Customer" : "New Customer"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave(new FormData(e.currentTarget));
          }}
          className="space-y-4"
        >
          <Field label="Full name" required>
            <input
  name="displayName"
  defaultValue={editing?.displayName}
  className="input-luxe"
  placeholder="e.g. Nimal Perera"
  onChange={(e) => {
    e.target.value = e.target.value.replace(
      /[^A-Za-z\s]/g,
      ""
    );
  }}
/>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Phone" required>
              <input
  name="phone"
  type="tel"
  defaultValue={editing?.phone}
  className="input-luxe"
  placeholder="0712345678"
  maxLength={10}
  onChange={(e) => {
    e.target.value = e.target.value.replace(
      /[^0-9]/g,
      ""
    );
  }}
/>
            </Field>
            <Field label="Email" required>
              <input
  name="email"
  type="email"
  defaultValue={editing?.email}
  className="input-luxe"
 
/>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Preferred channel">
              <select
                name="preferredChannel"
                defaultValue={editing?.preferredChannel ?? "sms"}
                className="input-luxe"
              >
                {CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch === "sms" ? "SMS" : ch === "whatsapp" ? "WhatsApp" : "Email"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Segment">
              <select
                name="segment"
                defaultValue={editing?.segment ?? "walkin"}
                className="input-luxe"
              >
                {SEGMENTS.map((s) => (
                  <option key={s} value={s}>
                    {s === "walkin" ? "Walk-in" : s.toUpperCase()}
                  </option>
                ))}
              </select>
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
              {saving ? "Saving…" : editing ? "Save changes" : "Add customer"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && doDelete(deleteId)}
        title="Delete this customer?"
        message="This permanently deletes the customer and all their vehicles. Their past job cards are kept for history. This cannot be undone."
        confirmLabel="Delete permanently"
        danger
      />
    </div>
  );
}
