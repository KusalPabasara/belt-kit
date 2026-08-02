"use client";

/**
 * Supplier service — 100% client-side Firestore (no Cloud Functions).
 * Free-tier safe. Collections: `suppliers`, `purchaseOrders`, `supplierPayments`.
 * All writes stamp branchId/createdAt/archived and are guarded by firestore.rules.
 */

import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type {
  CreatePurchaseOrderPayload,
  CreatePurchaseOrderResponse,
  CreateSupplierPaymentPayload,
  CreateSupplierPaymentResponse,
  CreateSupplierPayload,
  CreateSupplierResponse,
  Supplier,
  SupplierListResponse,
  SupplierSummaryResponse,
} from "../types/supplierTypes";

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new Error("No authenticated user available for supplier management.");
  return user;
}

/** Caller's branch from their own /users doc (default "main"). */
async function currentBranchId(): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) return "main";
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return (snap.data()?.branchId as string) || "main";
  } catch {
    return "main";
  }
}

export async function createSupplier(payload: CreateSupplierPayload): Promise<CreateSupplierResponse> {
  const uid = requireUser().uid;
  const branchId = await currentBranchId();
  const ref = await addDoc(collection(db, "suppliers"), {
    name: payload.name.trim(),
    phone: payload.phone?.trim() ?? "",
    email: payload.email?.trim() ?? "",
    branchId,
    archived: false,
    createdByUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { success: true, supplierId: ref.id };
}

export async function getSupplierList(): Promise<SupplierListResponse> {
  requireUser();
  const branchId = await currentBranchId();
  const snap = await getDocs(
    query(collection(db, "suppliers"), where("branchId", "==", branchId))
  );
  const suppliers = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as Supplier)
    .filter((s) => !(s as { archived?: boolean }).archived);
  return { success: true, suppliers };
}

export async function createPurchaseOrder(
  payload: CreatePurchaseOrderPayload
): Promise<CreatePurchaseOrderResponse> {
  const uid = requireUser().uid;
  const branchId = await currentBranchId();
  const totalMinor = (payload.items ?? []).reduce(
    (sum, it) => sum + Math.round((it.cost || 0) * (it.quantity || 0)),
    0
  );
  const ref = await addDoc(collection(db, "purchaseOrders"), {
    supplierId: payload.supplierId,
    items: payload.items ?? [],
    orderDate: payload.orderDate,
    totalMinor,
    branchId,
    archived: false,
    createdByUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { success: true, purchaseOrderId: ref.id };
}

export async function createSupplierPayment(
  payload: CreateSupplierPaymentPayload
): Promise<CreateSupplierPaymentResponse> {
  const uid = requireUser().uid;
  const branchId = await currentBranchId();
  const ref = await addDoc(collection(db, "supplierPayments"), {
    supplierId: payload.supplierId,
    amount: payload.amount,
    paymentDate: payload.paymentDate,
    note: payload.note?.trim() ?? "",
    branchId,
    archived: false,
    createdByUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { success: true, paymentId: ref.id };
}

export async function getSupplierSummary(supplierId: string): Promise<SupplierSummaryResponse> {
  requireUser();

  const supplierSnap = await getDoc(doc(db, "suppliers", supplierId));
  const supplierName = (supplierSnap.data()?.name as string) || undefined;

  const [poSnap, paySnap] = await Promise.all([
    getDocs(query(collection(db, "purchaseOrders"), where("supplierId", "==", supplierId))),
    getDocs(query(collection(db, "supplierPayments"), where("supplierId", "==", supplierId))),
  ]);

  const totalPurchased = poSnap.docs.reduce((sum, d) => {
    const data = d.data() as { totalMinor?: number; items?: { cost: number; quantity: number }[] };
    if (typeof data.totalMinor === "number") return sum + data.totalMinor;
    const itemsTotal = (data.items ?? []).reduce(
      (s, it) => s + Math.round((it.cost || 0) * (it.quantity || 0)),
      0
    );
    return sum + itemsTotal;
  }, 0);

  const totalPaid = paySnap.docs.reduce(
    (sum, d) => sum + ((d.data() as { amount?: number }).amount || 0),
    0
  );

  return {
    success: true,
    supplierId,
    supplierName,
    totalPurchased,
    totalPaid,
    outstanding: totalPurchased - totalPaid,
  };
}

const supplierService = {
  createSupplier,
  getSupplierList,
  createPurchaseOrder,
  createSupplierPayment,
  getSupplierSummary,
};

export default supplierService;
