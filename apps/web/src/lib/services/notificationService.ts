"use client";

/**
 * Notification service — 100% client-side Firestore (no Cloud Functions).
 * Marks the signed-in user's notifications as read. Guarded by firestore.rules
 * (a user may only update notifications addressed to them).
 */

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase";

/** Mark a single notification as read. */
export async function markNotificationRead(notificationId: string): Promise<void> {
  if (!notificationId.trim()) throw new Error("Notification ID is required.");
  await updateDoc(doc(db, "notifications", notificationId), {
    isRead: true,
    readAt: serverTimestamp(),
  });
}

/**
 * Mark all of the signed-in user's unread notifications as read.
 * Returns how many were updated.
 */
export async function markAllNotificationsRead(branchId?: string): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;

  const filters = [
    where("recipientUid", "==", uid),
    where("isRead", "==", false),
  ];
  if (branchId) filters.push(where("branchId", "==", branchId));

  const snap = await getDocs(query(collection(db, "notifications"), ...filters));
  if (snap.empty) return 0;

  // Batch in chunks of 400 (Firestore's batch limit is 500).
  const docs = snap.docs;
  let updated = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of docs.slice(i, i + 400)) {
      batch.update(d.ref, { isRead: true, readAt: serverTimestamp() });
      updated += 1;
    }
    await batch.commit();
  }
  return updated;
}

export default { markNotificationRead, markAllNotificationsRead };
