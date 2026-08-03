"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Car,
  ClipboardList,
  Fuel,
  Gauge,
  Maximize2,
  User,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useCollection, where } from "@/lib/useCollection";
import { Vehicle, Customer, JobCard, JOB_STATUS_META } from "@/lib/models";
import { formatDate, formatMoney } from "@/lib/format";
import { CenterSpinner, EmptyState, Badge, Modal } from "@/components/ui";

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePhoto, setActivePhoto] = useState<string | null>(null);

  const { data: jobs } = useCollection<JobCard>("jobCards", [
    where("vehicleId", "==", id),
  ]);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "vehicles", id));
      if (snap.exists()) {
        const v = snap.data() as Vehicle;
        setVehicle(v);
        if (v.customerId) {
          const cs = await getDoc(doc(db, "customers", v.customerId));
          if (cs.exists()) setCustomer(cs.data() as Customer);
        }
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <CenterSpinner label="Loading vehicle…" />;
  if (!vehicle)
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="Vehicle not found" hint="It may have been archived." />
      </div>
    );

  const damageItems = [
    vehicle.existingDamage?.scratches ? "Scratches" : null,
    vehicle.existingDamage?.dents ? "Dents / Dings" : null,
    vehicle.existingDamage?.crackedGlass ? "Cracked Glass" : null,
  ].filter((item): item is string => !!item);
  const beforePhotos = vehicle.photos?.before ?? [];
  const afterPhotos = vehicle.photos?.after ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={() => router.push("/dashboard/vehicles")}
        className="mb-6 flex items-center gap-2 font-sans text-sm text-ink-soft transition hover:text-burgundy-600"
      >
        <ArrowLeft size={16} /> All vehicles
      </button>

      <div className="card mb-6 p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-burgundy-deep text-white shadow-luxe">
            <Car size={34} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-3xl font-semibold text-burgundy-700">
                {vehicle.make} {vehicle.model}
              </h1>
              <span className="rounded-lg bg-burgundy-deep px-2.5 py-1 font-sans text-xs font-semibold uppercase tracking-wider text-white">
                {vehicle.plateNumber}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-sans text-sm text-ink-soft">
              {vehicle.year && <span>Year {vehicle.year}</span>}
              {vehicle.vin && <span>VIN {vehicle.vin}</span>}
              {vehicle.engine && <span>Engine {vehicle.engine}</span>}
            </div>
            {customer && (
              <Link
                href={`/dashboard/customers/${vehicle.customerId}`}
                className="mt-3 inline-flex items-center gap-1.5 font-sans text-sm text-burgundy-600 hover:text-burgundy-700"
              >
                <User size={14} /> {customer.displayName}
              </Link>
            )}
          </div>
        </div>
      </div>

      <section className="card mb-6 p-6">
        <div className="mb-5 flex items-center gap-3 border-b border-line pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-burgundy-50 text-burgundy-600">
            <Gauge size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink">Vehicle condition</h2>
            <p className="text-xs text-ink-soft">Condition recorded when the vehicle was registered.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface-muted/40 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <Gauge size={14} /> Odometer
            </p>
            <p className="mt-2 text-lg font-semibold text-ink">
              {vehicle.odometerReading !== undefined && vehicle.odometerReading !== null
                ? `${vehicle.odometerReading.toLocaleString()} km / miles`
                : "Not recorded"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface-muted/40 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <Fuel size={14} /> Fuel level
            </p>
            <p className="mt-2 text-lg font-semibold text-ink">
              {vehicle.fuelLevel || "Not recorded"}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-line p-4">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            <AlertTriangle size={14} className="text-amber-500" /> Existing damage
          </p>
          {damageItems.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {damageItems.map((item) => (
                <span key={item} className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-soft">No damage was selected.</p>
          )}
          {vehicle.existingDamage?.notes && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2.5 text-sm text-ink-soft">
              {vehicle.existingDamage.notes}
            </p>
          )}
        </div>
      </section>

      <section className="card mb-6 p-6">
        <div className="mb-5 flex items-center gap-3 border-b border-line pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-burgundy-50 text-burgundy-600">
            <Camera size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink">Before & after photos</h2>
            <p className="text-xs text-ink-soft">Photos saved with this vehicle record.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <VehiclePhotoGallery title="Before photos" photos={beforePhotos} onPreview={setActivePhoto} />
          <VehiclePhotoGallery title="After photos" photos={afterPhotos} onPreview={setActivePhoto} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 font-serif text-xl font-semibold text-ink">
          <ClipboardList size={20} className="text-rosegold-500" /> Service history
        </h2>
        {jobs.length === 0 ? (
          <EmptyState
            title="No service history"
            hint="Jobs opened for this vehicle will appear here."
          />
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

      <Modal open={!!activePhoto} onClose={() => setActivePhoto(null)} title="Vehicle photo">
        {activePhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={activePhoto} alt="Vehicle preview" className="max-h-[70vh] w-full rounded-xl object-contain" />
        )}
      </Modal>
    </div>
  );
}

function VehiclePhotoGallery({
  title,
  photos,
  onPreview,
}: {
  title: string;
  photos: string[];
  onPreview: (photo: string) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-muted/30 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink">
        {title} ({photos.length})
      </p>
      {photos.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-line bg-white text-sm text-ink-faint">
          No photos recorded
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onPreview(photo)}
              className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt={`${title} ${index + 1}`} className="h-full w-full object-cover transition group-hover:scale-105" />
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100">
                <Maximize2 size={18} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
