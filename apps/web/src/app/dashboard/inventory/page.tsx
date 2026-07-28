"use client";

import { useState, useMemo } from "react";
import {
  Package,
  Plus,
  AlertTriangle,
  Pencil,
  Trash2,
  Boxes,
  TrendingUp,
  TrendingDown,
  CircleAlert,
  History,
  ArrowUpRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/useCollection";
import { createDoc, updateDocById, deleteDocById } from "@/lib/db-write";
import { Part, StockMovement } from "@/lib/models";
import { canManageInventory } from "@/lib/permissions";
import { formatMoney, formatDateTime, toMinor } from "@/lib/format";
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
import { MiniBar, StatCard, VIZ } from "@/components/charts";

export default function InventoryPage() {
  const { branchId, role } = useAuth();
  const { data: parts, loading, error } = useCollection<Part>("parts");
  const { data: movements } = useCollection<StockMovement>("stockMovements");
  const { notify } = useToast();

  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<(Part & { id: string }) | null>(null);
  const [stockPart, setStockPart] = useState<(Part & { id: string }) | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = canManageInventory(role);

  const filtered = useMemo(() => {
    let rows = parts;
    const q = search.toLowerCase().trim();
    if (q)
      rows = rows.filter(
        (p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)
      );
    if (stockFilter === "low") rows = rows.filter((p) => p.lowStock);
    else if (stockFilter === "ok") rows = rows.filter((p) => !p.lowStock);
    return rows;
  }, [parts, search, stockFilter]);

  const lowCount = parts.filter((p) => p.lowStock).length;
  const stockValue = parts.reduce(
    (s, p) => s + p.sellPriceMinor * p.quantityOnHand,
    0
  );
  const costValue = parts.reduce(
    (sum, part) => sum + part.costPriceMinor * part.quantityOnHand,
    0
  );
  const outOfStockCount = parts.filter((part) => part.quantityOnHand === 0).length;
  const potentialMargin = stockValue - costValue;
  const attentionParts = useMemo(
    () =>
      parts
        .filter((part) => part.lowStock || part.quantityOnHand === 0)
        .sort((left, right) => left.quantityOnHand - right.quantityOnHand)
        .slice(0, 5),
    [parts]
  );
  const recentMovements = useMemo(
    () =>
      [...movements]
        .sort((left, right) => (right.createdAt?.toMillis?.() ?? 0) - (left.createdAt?.toMillis?.() ?? 0))
        .slice(0, 5),
    [movements]
  );
  const stockBars = useMemo(
    () =>
      [...parts]
        .sort((a, b) => b.quantityOnHand - a.quantityOnHand)
        .slice(0, 8)
        .map((p) => ({ label: p.sku || p.name.slice(0, 6), value: p.quantityOnHand })),
    [parts]
  );

  const columns: Column<Part & { id: string }>[] = [
    {
      key: "name",
      header: "Part",
      sortValue: (p) => p.name?.toLowerCase() ?? "",
      cell: (p) => (
        <div>
          <span className="flex items-center gap-2 font-medium text-ink group-hover:text-burgundy-600">
            {p.name}
            {p.lowStock && (
              <Badge tone="amber">
                <AlertTriangle size={11} /> Low
              </Badge>
            )}
          </span>
          {p.binLocation && (
            <span className="text-xs text-ink-faint">Bin {p.binLocation}</span>
          )}
        </div>
      ),
    },
    {
      key: "sku",
      header: "SKU",
      sortValue: (p) => p.sku?.toLowerCase() ?? "",
      hideBelow: "sm",
      cell: (p) => <span className="text-ink-soft">{p.sku}</span>,
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      sortValue: (p) => p.costPriceMinor,
      hideBelow: "md",
      cell: (p) => <span className="text-ink-soft">{formatMoney(p.costPriceMinor)}</span>,
    },
    {
      key: "sell",
      header: "Sell",
      align: "right",
      sortValue: (p) => p.sellPriceMinor,
      cell: (p) => (
        <span className="font-medium text-ink">{formatMoney(p.sellPriceMinor)}</span>
      ),
    },
    {
      key: "stock",
      header: "In stock",
      align: "center",
      sortValue: (p) => p.quantityOnHand,
      cell: (p) => (
        <div className="min-w-28">
          <span className={`font-semibold ${p.lowStock ? "text-amber-600" : "text-ink"}`}>{p.quantityOnHand}</span>
          <span className="text-ink-faint"> / {p.reorderThreshold}</span>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div className={`h-full rounded-full ${p.lowStock ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, p.reorderThreshold > 0 ? (p.quantityOnHand / (p.reorderThreshold * 2)) * 100 : 100)}%` }} />
          </div>
        </div>
      ),
    },
  ];

  async function handleSave(form: FormData) {
  if (!branchId) return;

  const quantityOnHand = Number(form.get("quantityOnHand"));
  const reorderThreshold = Number(form.get("reorderThreshold"));
  const cost = Number(form.get("cost"));
  const sell = Number(form.get("sell"));

  if (!form.get("name") || !form.get("sku")) {
    notify("Part name and SKU are required.", "error");
    return;
  }

  if (isNaN(cost) || cost <= 0) {
    notify("Cost price must be greater than 0.", "error");
    return;
  }

  if (isNaN(sell) || sell <= 0) {
    notify("Sell price must be greater than 0.", "error");
    return;
  }

  if (isNaN(quantityOnHand) || quantityOnHand <= 0) {
  notify("Quantity on hand must be greater than 0.", "error");
  return;
}

if (isNaN(reorderThreshold) || reorderThreshold <= 0) {
  notify("Reorder level must be greater than 0.", "error");
  return;
}

const binLocation = String(form.get("bin") || "").trim();

if (!binLocation) {
  notify("Bin location is required.", "error");
  return;
}

  setSaving(true);
    const payload = {
      sku: String(form.get("sku") || "").trim(),
      name: String(form.get("name") || "").trim(),
      costPriceMinor: toMinor(String(form.get("cost") || "0")),
      sellPriceMinor: toMinor(String(form.get("sell") || "0")),
      quantityOnHand,
      reorderThreshold,
      lowStock: quantityOnHand <= reorderThreshold,
      binLocation,
    };
    if (!payload.name || !payload.sku) {
      notify("Name and SKU are required.", "error");
      setSaving(false);
      return;
    }
    try {
      if (editing) {
        await updateDocById("parts", editing.id, payload);
        notify("Part updated.");
      } else {
        await createDoc("parts", branchId, payload);
        notify("Part added.");
      }
      setModalOpen(false);
    } catch {
      notify("Could not save part.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function adjustStock(form: FormData) {
    if (!stockPart) return;
    const delta = Number(form.get("delta") || 0);
    const newQty = Math.max(0, stockPart.quantityOnHand + delta);
    try {
      await updateDocById("parts", stockPart.id, {
        quantityOnHand: newQty,
        lowStock: newQty <= stockPart.reorderThreshold,
      });
      await createDoc("stockMovements", stockPart.branchId, {
        partId: stockPart.id,
        delta,
        reason: delta < 0 ? "adjustment" : "purchase",
        jobCardId: null,
      });
      notify("Stock updated.");
      setStockPart(null);
    } catch {
      notify("Could not adjust stock.", "error");
    }
  }

  async function doDelete(id: string) {
    try {
      await deleteDocById("parts", id);
      notify("Part deleted.");
    } catch {
      notify("Could not delete part.", "error");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Stock"
        title="Inventory"
        icon={Package}
        action={
          canEdit && (
            <button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
              className="btn-primary"
            >
              <Plus size={18} /> New Part
            </button>
          )
        }
      />

      {parts.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="card p-6 lg:col-span-2">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-ink">Stock on hand</h2>
              <p className="text-xs text-ink-faint">Top parts by quantity</p>
            </div>
            <MiniBar data={stockBars} color={VIZ.teal} height={190} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <StatCard
              label="Total SKUs"
              value={String(parts.length)}
              icon={<Package size={16} />}
              accent={VIZ.indigo}
            />
            <StatCard
              label="Low stock"
              value={String(lowCount)}
              icon={<AlertTriangle size={16} />}
              accent={VIZ.rose}
            />
            <StatCard
              label="Stock value"
              value={formatMoney(stockValue)}
              icon={<Boxes size={16} />}
              accent={VIZ.emerald}
            />
            <StatCard
              label="Out of stock"
              value={String(outOfStockCount)}
              hint="Needs ordering now"
              icon={<CircleAlert size={16} />}
              accent={VIZ.rose}
            />
          </div>
        </div>
      )}

      {parts.length > 0 && (
        <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]">
          <section className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-ink">Needs attention</h2>
                <p className="mt-0.5 text-xs text-ink-faint">Low and out-of-stock parts that may delay job cards.</p>
              </div>
              <button onClick={() => setStockFilter("low")} className="text-xs font-semibold text-burgundy-600 hover:text-burgundy-700">View low stock <ArrowUpRight size={13} className="inline" /></button>
            </div>
            {attentionParts.length ? <div className="mt-4 divide-y divide-line rounded-xl border border-line">{attentionParts.map((part) => {
              const suggested = Math.max(1, part.reorderThreshold * 2 - part.quantityOnHand);
              return <div key={part.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="text-sm font-medium text-ink">{part.name}</p><p className="text-xs text-ink-faint">{part.sku} · Bin {part.binLocation || "not set"}</p></div><div className="flex items-center gap-4"><div className="text-right"><p className={`text-sm font-semibold ${part.quantityOnHand === 0 ? "text-rose-600" : "text-amber-600"}`}>{part.quantityOnHand} in stock</p><p className="text-xs text-ink-faint">Suggested order: {suggested}</p></div>{canEdit && <button onClick={() => setStockPart(part)} className="btn-ghost px-3 py-2 text-xs"><Boxes size={14} /> Receive</button>}</div></div>;
            })}</div> : <div className="mt-4 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/50 p-5 text-sm text-emerald-700">All current parts are above their reorder level.</div>}
          </section>
          <section className="card p-6">
            <div className="flex items-start gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><TrendingUp size={18} /></div><div><p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Potential stock margin</p><p className="mt-1 text-2xl font-bold text-ink">{formatMoney(potentialMargin)}</p><p className="mt-1 text-xs text-ink-faint">Retail value {formatMoney(stockValue)} minus cost value {formatMoney(costValue)}</p></div></div>
            <div className="mt-5 rounded-xl bg-surface-muted p-4"><p className="text-sm font-semibold text-ink">Quick actions</p><div className="mt-3 grid grid-cols-2 gap-2">{canEdit && <button onClick={() => { setEditing(null); setModalOpen(true); }} className="btn-ghost justify-center px-3 py-2 text-xs"><Plus size={14} /> Add part</button>}<button onClick={() => setStockFilter("low")} className="btn-ghost justify-center px-3 py-2 text-xs"><AlertTriangle size={14} /> Reorder queue</button></div></div>
          </section>
        </div>
      )}

      {parts.length > 0 && (
        <section className="card mb-5 p-6">
          <div className="flex items-center gap-2"><History size={17} className="text-burgundy-600" /><div><h2 className="text-base font-semibold text-ink">Recent stock activity</h2><p className="text-xs text-ink-faint">Latest purchases and manual adjustments.</p></div></div>
          {recentMovements.length ? <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">{recentMovements.map((movement) => { const part = parts.find((item) => item.id === movement.partId); return <div key={movement.id} className="rounded-xl border border-line bg-surface p-3"><div className="flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${movement.delta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{movement.delta >= 0 ? `+${movement.delta}` : movement.delta}</span><span className="text-[10px] uppercase tracking-wide text-ink-faint">{movement.reason.replace("_", " ")}</span></div><p className="mt-2 truncate text-sm font-medium text-ink">{part?.name ?? "Removed part"}</p><p className="mt-1 text-xs text-ink-faint">{formatDateTime(movement.createdAt)}</p></div>; })}</div> : <p className="mt-4 text-sm text-ink-faint">No stock movements recorded yet.</p>}
        </section>
      )}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          value={stockFilter}
          onChange={setStockFilter}
          options={[
            { value: "all", label: "All", count: parts.length },
            { value: "low", label: "Low stock", count: lowCount },
            { value: "ok", label: "In stock", count: parts.length - lowCount },
          ]}
        />
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name or SKU…"
          className="w-full sm:max-w-xs"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-burgundy-50 px-4 py-3 font-sans text-sm text-burgundy-600">
          {error}
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={5} />
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          initialSort={{ key: "name", dir: "asc" }}
          rowActions={
            canEdit
              ? (p) => (
                  <>
                    <button
                      onClick={() => setStockPart(p)}
                      className="rounded-lg px-2 py-1 font-sans text-xs text-ink-soft transition hover:bg-surface-muted hover:text-burgundy-600"
                    >
                      <Boxes size={14} className="mr-1 inline" />
                      Stock
                    </button>
                    <button
                      onClick={() => {
                        setEditing(p);
                        setModalOpen(true);
                      }}
                      className="rounded-lg p-2 text-ink-faint transition hover:bg-surface-muted hover:text-burgundy-600"
                      aria-label="Edit"
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => setDeleteId(p.id)}
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
              icon={Package}
              title={search || stockFilter !== "all" ? "No matches" : "No parts yet"}
              hint={
                search || stockFilter !== "all"
                  ? "Adjust your filters."
                  : "Add parts to your catalogue so they can be used on job cards."
              }
            />
          }
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Part" : "New Part"}
        size="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave(new FormData(e.currentTarget));
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Part name" required>
              <input
                name="name"
                defaultValue={editing?.name}
                className="input-luxe"
                placeholder="Oil filter"
              />
            </Field>
            <Field label="SKU" required>
              <input
                name="sku"
                defaultValue={editing?.sku}
                className="input-luxe"
                placeholder="OF-1023"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Cost price (LKR) *">
              <input
  name="cost"
  required
  defaultValue={editing ? (editing.costPriceMinor / 100).toString() : ""}
  className="input-luxe"
  placeholder="0.00"
  inputMode="decimal"
/>
            </Field>
            <Field label="Sell price (LKR) *">
              <input
                name="sell"
                  required

                defaultValue={editing ? (editing.sellPriceMinor / 100).toString() : ""}
                className="input-luxe"
                placeholder="0.00"
                inputMode="decimal"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Qty on hand *">
  <input
    name="quantityOnHand"
    type="number"
    min={0}
    required
    defaultValue={editing?.quantityOnHand ?? ""}
    className="input-luxe"
  />
</Field>
            <Field label="Reorder at *">
  <input
    name="reorderThreshold"
    type="number"
    min={0}
    required
    defaultValue={editing?.reorderThreshold ?? ""}
    className="input-luxe"
  />
</Field>
            <Field label="Bin location *">
  <input
    name="bin"
    required
    defaultValue={editing?.binLocation}
    className="input-luxe"
    placeholder="A-12"
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
              {saving ? "Saving…" : editing ? "Save changes" : "Add part"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!stockPart}
        onClose={() => setStockPart(null)}
        title={`Adjust stock — ${stockPart?.name ?? ""}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            adjustStock(new FormData(e.currentTarget));
          }}
          className="space-y-4"
        >
          <p className="font-sans text-sm text-ink-soft">
            Current stock:{" "}
            <span className="font-semibold text-ink">
              {stockPart?.quantityOnHand}
            </span>
          </p>
          <Field
            label="Change (use a negative number to remove)"
            required
            hint="e.g. 10 to receive stock, -2 to write off."
          >
            <input name="delta" type="number" className="input-luxe" placeholder="10" />
          </Field>
          <div className="flex justify-between gap-3 pt-2">
            <div className="flex gap-2 text-ink-faint">
              <TrendingUp size={18} className="text-emerald-500" />
              <TrendingDown size={18} className="text-burgundy-400" />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStockPart(null)}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Apply
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && doDelete(deleteId)}
        title="Delete this part?"
        message="This permanently removes the part from your catalogue. This cannot be undone."
        confirmLabel="Delete permanently"
        danger
      />
    </div>
  );
}
