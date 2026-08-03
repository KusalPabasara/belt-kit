"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Car } from "lucide-react";
import { useCollection } from "@/lib/useCollection";
import { Customer, Vehicle } from "@/lib/models";
import {
  Column,
  DataTable,
  EmptyState,
  PageHeader,
  SearchInput,
  TableSkeleton,
} from "@/components/ui";

export default function VehiclesPage() {
  const router = useRouter();
  const { data: vehicles, loading, error } = useCollection<Vehicle>("vehicles");
  const { data: customers } = useCollection<Customer>("customers");
  const [search, setSearch] = useState("");

  const customerName = (customerId: string) =>
    customers.find((customer) => customer.id === customerId)?.displayName ??
    "Unknown owner";

  const filtered = useMemo(() => {
    const searchValue = search.toLowerCase().trim();
    if (!searchValue) return vehicles;

    return vehicles.filter(
      (vehicle) =>
        vehicle.plateNumber?.toLowerCase().includes(searchValue) ||
        vehicle.make?.toLowerCase().includes(searchValue) ||
        vehicle.model?.toLowerCase().includes(searchValue) ||
        customerName(vehicle.customerId).toLowerCase().includes(searchValue),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, search, vehicles]);

  const columns: Column<Vehicle & { id: string }>[] = [
    {
      key: "vehicle",
      header: "Vehicle",
      sortValue: (vehicle) =>
        `${vehicle.make} ${vehicle.model}`.toLowerCase(),
      cell: (vehicle) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-burgundy-500">
            <Car size={17} />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink group-hover:text-burgundy-600">
              {vehicle.make} {vehicle.model}
            </p>
            {vehicle.year && (
              <p className="text-xs text-ink-faint">{vehicle.year}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "plate",
      header: "Plate",
      sortValue: (vehicle) => vehicle.plateNumber ?? "",
      cell: (vehicle) => (
        <span className="inline-block rounded-md bg-burgundy-deep px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-white">
          {vehicle.plateNumber}
        </span>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      sortValue: (vehicle) =>
        customerName(vehicle.customerId).toLowerCase(),
      hideBelow: "sm",
      cell: (vehicle) => (
        <span className="text-ink-soft">
          {customerName(vehicle.customerId)}
        </span>
      ),
    },
    {
      key: "condition",
      header: "Condition",
      hideBelow: "lg",
      cell: (vehicle) => (
        <span className="text-xs text-ink-faint">
          {vehicle.odometerReading !== undefined && vehicle.odometerReading !== null
            ? `${vehicle.odometerReading.toLocaleString()} km / miles`
            : "Odometer not recorded"}
          {vehicle.fuelLevel ? ` · ${vehicle.fuelLevel} fuel` : ""}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Records" title="Vehicles" icon={Car} />

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-sans text-sm text-ink-soft">
          Vehicles are registered together with their customers.
        </p>
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
          onRowClick={(vehicle) =>
            router.push(`/dashboard/vehicles/${vehicle.id}`)
          }
          emptyState={
            <EmptyState
              icon={Car}
              title={search ? "No matches" : "No vehicles yet"}
              hint={
                search
                  ? "Try another search."
                  : "Add a customer and vehicle from the Customers page."
              }
            />
          }
        />
      )}
    </div>
  );
}
