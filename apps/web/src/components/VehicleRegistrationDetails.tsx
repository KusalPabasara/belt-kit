"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Camera,
  Fuel,
  Gauge,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Trash2,
  Upload,
} from "lucide-react";
import { Field, Modal, useToast } from "@/components/ui";

type PhotoCategory = "before" | "after";

const MAX_PHOTOS_PER_CATEGORY = 3;

function compressToDataUrl(
  file: File,
  maxDimension = 560,
  quality = 0.48,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not process the image."));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = image;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Could not prepare the image."));
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function VehicleRegistrationDetails() {
  const { notify } = useToast();
  const [beforePhotos, setBeforePhotos] = useState<string[]>([]);
  const [afterPhotos, setAfterPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState<PhotoCategory | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function addPhotos(category: PhotoCategory, files: FileList | null) {
    if (!files?.length) return;

    const current = category === "before" ? beforePhotos : afterPhotos;
    const remainingSlots = MAX_PHOTOS_PER_CATEGORY - current.length;
    if (remainingSlots <= 0) {
      notify(`A maximum of ${MAX_PHOTOS_PER_CATEGORY} ${category} photos is allowed.`, "error");
      return;
    }

    setUploading(category);
    try {
      const selectedFiles = Array.from(files).slice(0, remainingSlots);
      const acceptedFiles = selectedFiles.filter((file) => {
        if (!file.type.startsWith("image/")) {
          notify(`${file.name} is not an image.`, "error");
          return false;
        }
        if (file.size > 10 * 1024 * 1024) {
          notify(`${file.name} is larger than 10 MB.`, "error");
          return false;
        }
        return true;
      });

      const compressed = await Promise.all(
        acceptedFiles.map((file) => compressToDataUrl(file)),
      );
      const updated = [...current, ...compressed];

      if (category === "before") setBeforePhotos(updated);
      else setAfterPhotos(updated);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not process the selected photos.",
        "error",
      );
    } finally {
      setUploading(null);
    }
  }

  function removePhoto(category: PhotoCategory, photo: string) {
    if (category === "before") {
      setBeforePhotos((current) => current.filter((item) => item !== photo));
    } else {
      setAfterPhotos((current) => current.filter((item) => item !== photo));
    }
  }

  return (
    <>
      <input type="hidden" name="beforePhotos" value={JSON.stringify(beforePhotos)} />
      <input type="hidden" name="afterPhotos" value={JSON.stringify(afterPhotos)} />
      <input type="hidden" name="photoUploadInProgress" value={uploading ? "true" : ""} />

      <div className="space-y-4 rounded-xl border border-line bg-surface-muted/30 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-burgundy-50 text-burgundy-600">
            <Gauge size={18} />
          </div>
          <div>
            <h3 className="font-sans text-sm font-semibold text-ink">Vehicle condition</h3>
            <p className="font-sans text-xs text-ink-soft">
              Record the condition when registering the vehicle.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Odometer reading" required>
            <div className="relative">
              <Gauge className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" size={16} />
              <input
                name="odometerReading"
                type="number"
                min="0"
                required
                className="input-luxe pl-10"
                placeholder="e.g. 45200"
              />
            </div>
          </Field>
          <Field label="Fuel level" required>
            <div className="relative">
              <Fuel className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" size={16} />
              <select name="fuelLevel" defaultValue="Half" className="input-luxe pl-10">
                <option value="Empty">Empty (Reserve)</option>
                <option value="Quarter">Quarter Tank (1/4)</option>
                <option value="Half">Half Tank (1/2)</option>
                <option value="Full">Full Tank</option>
              </select>
            </div>
          </Field>
        </div>

        <div className="rounded-xl border border-line bg-white p-4">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">
            <AlertTriangle size={14} className="text-amber-500" /> Existing damage
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              ["damageScratches", "Scratches"],
              ["damageDents", "Dents / Dings"],
              ["damageCrackedGlass", "Cracked Glass"],
            ].map(([name, label]) => (
              <label key={name} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm text-ink">
                <input name={name} type="checkbox" className="h-4 w-4 accent-burgundy-600" />
                {label}
              </label>
            ))}
          </div>
          <textarea
            name="damageNotes"
            rows={2}
            className="input-luxe mt-3"
            placeholder="Describe existing damage and its location…"
          />
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-line bg-surface-muted/30 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-burgundy-50 text-burgundy-600">
            <Camera size={18} />
          </div>
          <div>
            <h3 className="font-sans text-sm font-semibold text-ink">Before & after photos</h3>
            <p className="font-sans text-xs text-ink-soft">
              Up to {MAX_PHOTOS_PER_CATEGORY} compressed photos in each section.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PhotoInput
            category="before"
            title="Before photos"
            photos={beforePhotos}
            uploading={uploading === "before"}
            onAdd={addPhotos}
            onRemove={removePhoto}
            onPreview={setPreview}
          />
          <PhotoInput
            category="after"
            title="After photos"
            photos={afterPhotos}
            uploading={uploading === "after"}
            onAdd={addPhotos}
            onRemove={removePhoto}
            onPreview={setPreview}
          />
        </div>
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} title="Vehicle photo">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Vehicle preview" className="max-h-[70vh] w-full rounded-xl object-contain" />
        )}
      </Modal>
    </>
  );
}

interface PhotoInputProps {
  category: PhotoCategory;
  title: string;
  photos: string[];
  uploading: boolean;
  onAdd: (category: PhotoCategory, files: FileList | null) => void;
  onRemove: (category: PhotoCategory, photo: string) => void;
  onPreview: (photo: string) => void;
}

function PhotoInput({
  category,
  title,
  photos,
  uploading,
  onAdd,
  onRemove,
  onPreview,
}: PhotoInputProps) {
  const inputId = `vehicle-${category}-photos`;

  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink">
          {title} ({photos.length})
        </span>
        <label htmlFor={inputId} className={`btn-ghost cursor-pointer px-2.5 py-1.5 text-xs ${uploading ? "pointer-events-none opacity-60" : ""}`}>
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {uploading ? "Processing…" : "Add"}
          <input
            id={inputId}
            type="file"
            accept="image/*"
            multiple
            disabled={uploading}
            className="hidden"
            onChange={(event) => {
              void onAdd(category, event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {photos.length === 0 ? (
        <div className="flex min-h-24 flex-col items-center justify-center rounded-lg border border-dashed border-line text-center text-xs text-ink-faint">
          <ImageIcon size={20} className="mb-1" /> No photos selected
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo, index) => (
            <div key={`${category}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt={`${title} ${index + 1}`} className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition group-hover:opacity-100">
                <button type="button" onClick={() => onPreview(photo)} className="rounded-full bg-white/25 p-1.5 text-white" title="Preview">
                  <Maximize2 size={13} />
                </button>
                <button type="button" onClick={() => onRemove(category, photo)} className="rounded-full bg-red-500/50 p-1.5 text-white" title="Remove">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
