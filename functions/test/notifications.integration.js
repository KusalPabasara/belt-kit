/* eslint-disable no-console */
"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = "belt-kit";
const FUNCTIONS_PORT = process.env.NOTIFICATION_FUNCTIONS_PORT || "5001";
const FUNCTIONS_BASE = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/us-central1`;
const AUTH_BASE = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099"}`;
const RUN_ID = `notification-it-${Date.now()}-${randomUUID().slice(0, 8)}`;
const PASSWORD = "Local-only-Password-123!";
const MAIN_BRANCH = `${RUN_ID}-main-branch`;
const OTHER_BRANCH = `${RUN_ID}-other-branch`;
const results = [];

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("This test must run through Firebase emulators:exec.");
}

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

async function test(name, callback) {
  try {
    await callback();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", detail: error.stack || String(error) });
    console.error(`FAIL ${name}\n${error.stack || error}`);
  }
}

async function waitFor(check, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function createTestUser(label, role, branchId) {
  const email = `${label}.${RUN_ID}@example.test`;
  const record = await auth.createUser({ email, password: PASSWORD, displayName: label });
  await db.collection("users").doc(record.uid).set({
    email,
    displayName: label,
    role,
    branchId,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { uid: record.uid, email, role, branchId };
}

async function signIn(user) {
  const response = await fetch(
    `${AUTH_BASE}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password: PASSWORD, returnSecureToken: true }),
    },
  );
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.idToken;
}

async function callCallable(name, data, token) {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  return { status: response.status, body: await response.json() };
}

async function notifications(filters = []) {
  let query = db.collection("notifications");
  for (const [field, value] of filters) query = query.where(field, "==", value);
  return (await query.get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function countNotifications(filters) {
  return (await notifications(filters)).length;
}

async function main() {
  const owner = await createTestUser("owner", "owner", MAIN_BRANCH);
  const manager = await createTestUser("manager", "manager", MAIN_BRANCH);
  const advisor = await createTestUser("advisor", "advisor", MAIN_BRANCH);
  const technician = await createTestUser("technician", "technician", MAIN_BRANCH);
  const otherAdvisor = await createTestUser("other-advisor", "advisor", OTHER_BRANCH);
  const secondUser = await createTestUser("second-user", "accountant", MAIN_BRANCH);
  const eligibleMainUids = [owner.uid, manager.uid, advisor.uid].sort();

  await test("low stock: above threshold creates no notification", async () => {
    await db.collection("parts").doc(`${RUN_ID}-part`).set({
      name: "Integration Brake Pad", branchId: MAIN_BRANCH,
      quantityOnHand: 10, reorderThreshold: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(await countNotifications([["relatedPartId", `${RUN_ID}-part`]]), 0);
  });

  await test("low stock: crossing threshold targets eligible same-branch users", async () => {
    await db.collection("parts").doc(`${RUN_ID}-part`).update({ quantityOnHand: 5 });
    const rows = await waitFor(async () => {
      const found = await notifications([["relatedPartId", `${RUN_ID}-part`]]);
      return found.length === 3 ? found : null;
    }, "three low-stock notifications");
    assert.deepEqual(rows.map((row) => row.recipientUid).sort(), eligibleMainUids);
    assert.equal(rows.some((row) => row.recipientUid === otherAdvisor.uid), false);
    assert.equal(rows.some((row) => row.recipientUid === technician.uid), false);
    for (const row of rows) {
      assert.equal(row.type, "LOW_STOCK");
      assert.equal(row.targetType, "PART");
      assert.equal(row.targetId, `${RUN_ID}-part`);
      assert.equal(row.relatedPartId, `${RUN_ID}-part`);
    }
  });

  await test("low stock: remaining low does not duplicate", async () => {
    await db.collection("parts").doc(`${RUN_ID}-part`).update({ quantityOnHand: 4 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(await countNotifications([["relatedPartId", `${RUN_ID}-part`]]), 3);
  });

  await test("low stock: restock then recross creates a new alert", async () => {
    const ref = db.collection("parts").doc(`${RUN_ID}-part`);
    await ref.update({ quantityOnHand: 20 });
    await new Promise((resolve) => setTimeout(resolve, 750));
    await ref.update({ quantityOnHand: 5 });
    await waitFor(
      async () => (await countNotifications([["relatedPartId", `${RUN_ID}-part`]])) === 6,
      "second low-stock alert set",
    );
  });

  const attendanceId = `${RUN_ID}-attendance`;
  await test("leave: present creates no alert", async () => {
    await db.collection("attendance").doc(attendanceId).set({
      employeeId: technician.uid, branchId: MAIN_BRANCH,
      date: "2030-01-15", status: "present", note: "initial",
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(await countNotifications([["relatedAttendanceId", attendanceId]]), 0);
  });

  await test("leave: transition to on_leave alerts eligible same-branch users", async () => {
    await db.collection("attendance").doc(attendanceId).update({ status: "on_leave" });
    const rows = await waitFor(async () => {
      const found = await notifications([["relatedAttendanceId", attendanceId]]);
      return found.length === 3 ? found : null;
    }, "three leave notifications");
    assert.deepEqual(rows.map((row) => row.recipientUid).sort(), eligibleMainUids);
    assert.equal(rows.some((row) => row.recipientUid === otherAdvisor.uid), false);
    assert.equal(rows.some((row) => row.recipientUid === technician.uid), false);
    for (const row of rows) {
      assert.equal(row.relatedEmployeeId, technician.uid);
      assert.equal(row.attendanceDate, "2030-01-15");
      assert.equal(row.targetType, "ATTENDANCE");
      assert.equal(row.targetId, attendanceId);
    }
  });

  await test("leave: unrelated edit while on_leave does not duplicate", async () => {
    await db.collection("attendance").doc(attendanceId).update({ note: "changed" });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(await countNotifications([["relatedAttendanceId", attendanceId]]), 3);
  });

  await test("leave: present then on_leave creates a new valid alert", async () => {
    const ref = db.collection("attendance").doc(attendanceId);
    await ref.update({ status: "present" });
    await new Promise((resolve) => setTimeout(resolve, 750));
    await ref.update({ status: "on_leave" });
    await waitFor(
      async () => (await countNotifications([["relatedAttendanceId", attendanceId]])) === 6,
      "second leave notification set",
    );
  });

  const futureJobId = `${RUN_ID}-job-future`;
  const futureDate = Timestamp.fromMillis(Date.now() + 20 * 86400000);
  await test("service: non-final job creates no reminder", async () => {
    await db.collection("jobCards").doc(futureJobId).set({
      branchId: MAIN_BRANCH, vehicleId: `${RUN_ID}-vehicle-future`,
      customerId: `${RUN_ID}-customer`, status: "in_progress", nextServiceDate: futureDate,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal((await db.collection("serviceReminders").doc(futureJobId).get()).exists, false);
  });

  await test("service: delivered creates future reminder seven days before", async () => {
    await db.collection("jobCards").doc(futureJobId).update({ status: "delivered" });
    const reminder = await waitFor(async () => {
      const snapshot = await db.collection("serviceReminders").doc(futureJobId).get();
      return snapshot.exists ? snapshot.data() : null;
    }, "future service reminder");
    assert.equal(reminder.nextServiceDate.toMillis(), futureDate.toMillis());
    assert.equal(reminder.notifyAt.toMillis(), futureDate.toMillis() - 7 * 86400000);
    assert.equal(reminder.notifiedAt, null);
    assert.equal(await countNotifications([["relatedJobCardId", futureJobId]]), 0);
  });

  await test("service: unrelated delivered edit does not duplicate or reset", async () => {
    const before = (await db.collection("serviceReminders").doc(futureJobId).get()).data();
    await db.collection("jobCards").doc(futureJobId).update({ complaint: "unrelated edit" });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const after = (await db.collection("serviceReminders").doc(futureJobId).get()).data();
    assert.equal(after.notifyAt.toMillis(), before.notifyAt.toMillis());
    assert.equal(after.updatedAt.toMillis(), before.updatedAt.toMillis());
  });

  await test("service: changed near date safely updates and immediately notifies", async () => {
    const nearDate = Timestamp.fromMillis(Date.now() + 3 * 86400000);
    await db.collection("jobCards").doc(futureJobId).update({ nextServiceDate: nearDate });
    const reminder = await waitFor(async () => {
      const data = (await db.collection("serviceReminders").doc(futureJobId).get()).data();
      return data?.notifiedAt ? data : null;
    }, "immediate service notification");
    assert.equal(reminder.nextServiceDate.toMillis(), nearDate.toMillis());
    assert.equal(reminder.notificationCount, 3);
    const rows = await notifications([["relatedJobCardId", futureJobId]]);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.recipientUid).sort(), eligibleMainUids);
  });

  await test("scheduled processor: due reminder processes once and is idempotent", async () => {
    const jobCardId = `${RUN_ID}-scheduled-valid`;
    const nextServiceDate = Timestamp.fromMillis(Date.now() + 86400000);
    await db.collection("serviceReminders").doc(jobCardId).set({
      branchId: MAIN_BRANCH, jobCardId, vehicleId: `${RUN_ID}-vehicle-scheduled`,
      nextServiceDate, notifyAt: Timestamp.fromMillis(Date.now() - 60000),
      notifiedAt: null, notificationCount: 0,
    });
    const { processDueServiceReminders } = require("../lib/notifications/processServiceReminders");
    const first = await processDueServiceReminders();
    assert.ok(first.processedCount >= 1);
    const reminder = (await db.collection("serviceReminders").doc(jobCardId).get()).data();
    assert.ok(reminder.notifiedAt);
    assert.equal(reminder.notificationCount, 3);
    assert.equal(await countNotifications([["relatedJobCardId", jobCardId]]), 3);
    const second = await processDueServiceReminders();
    assert.equal(second.processedCount, 0);
    assert.equal(await countNotifications([["relatedJobCardId", jobCardId]]), 3);
  });

  await test("scheduled processor: invalid reminder is terminally marked", async () => {
    const reminderId = `${RUN_ID}-scheduled-invalid`;
    await db.collection("serviceReminders").doc(reminderId).set({
      branchId: MAIN_BRANCH, jobCardId: reminderId,
      notifyAt: Timestamp.fromMillis(Date.now() - 60000), notifiedAt: null,
    });
    const { processDueServiceReminders } = require("../lib/notifications/processServiceReminders");
    await processDueServiceReminders();
    const data = (await db.collection("serviceReminders").doc(reminderId).get()).data();
    assert.ok(data.notifiedAt);
    assert.equal(data.processingError, "Invalid service reminder data.");
    const again = await processDueServiceReminders();
    assert.equal(again.processedCount, 0);
  });

  const advisorToken = await signIn(advisor);
  const secondToken = await signIn(secondUser);
  let callableNotificationId;
  await test("markNotificationRead: owner marks own notification and retry is safe", async () => {
    const row = (await notifications([["recipientUid", advisor.uid], ["type", "LOW_STOCK"]]))[0];
    callableNotificationId = row.id;
    const response = await callCallable("markNotificationRead", { notificationId: row.id }, advisorToken);
    assert.equal(response.status, 200);
    assert.equal(response.body.result.success, true);
    let data = (await db.collection("notifications").doc(row.id).get()).data();
    assert.equal(data.isRead, true);
    assert.ok(data.readAt);
    const firstReadAt = data.readAt.toMillis();
    const retry = await callCallable("markNotificationRead", { notificationId: row.id }, advisorToken);
    assert.equal(retry.body.result.success, true);
    data = (await db.collection("notifications").doc(row.id).get()).data();
    assert.equal(data.readAt.toMillis(), firstReadAt);
  });

  await test("markNotificationRead: different user is denied", async () => {
    const response = await callCallable("markNotificationRead", { notificationId: callableNotificationId }, secondToken);
    assert.equal(response.body.error.status, "PERMISSION_DENIED");
  });
  await test("markNotificationRead: missing auth is rejected", async () => {
    const response = await callCallable("markNotificationRead", { notificationId: callableNotificationId });
    assert.equal(response.body.error.status, "UNAUTHENTICATED");
  });
  await test("markNotificationRead: missing ID is rejected", async () => {
    const response = await callCallable("markNotificationRead", {}, advisorToken);
    assert.equal(response.body.error.status, "INVALID_ARGUMENT");
  });
  await test("markNotificationRead: unknown ID returns not found", async () => {
    const response = await callCallable("markNotificationRead", { notificationId: `${RUN_ID}-missing` }, advisorToken);
    assert.equal(response.body.error.status, "NOT_FOUND");
  });

  await test("markAllNotificationsRead: branch filter isolates user and branch", async () => {
    const docs = [
      [`${RUN_ID}-all-own-main-1`, advisor.uid, MAIN_BRANCH],
      [`${RUN_ID}-all-own-main-2`, advisor.uid, MAIN_BRANCH],
      [`${RUN_ID}-all-own-other`, advisor.uid, OTHER_BRANCH],
      [`${RUN_ID}-all-other-user`, secondUser.uid, MAIN_BRANCH],
    ];
    await Promise.all(docs.map(([id, recipientUid, branchId]) =>
      db.collection("notifications").doc(id).set({ recipientUid, branchId, isRead: false, readAt: null, type: "LOW_STOCK" }),
    ));
    const expectedUpdatedCount = await countNotifications([
      ["recipientUid", advisor.uid],
      ["branchId", MAIN_BRANCH],
      ["isRead", false],
    ]);
    const response = await callCallable("markAllNotificationsRead", { branchId: MAIN_BRANCH }, advisorToken);
    assert.equal(response.body.result.updatedCount, expectedUpdatedCount);
    assert.equal((await db.collection("notifications").doc(docs[0][0]).get()).data().isRead, true);
    assert.equal((await db.collection("notifications").doc(docs[2][0]).get()).data().isRead, false);
    assert.equal((await db.collection("notifications").doc(docs[3][0]).get()).data().isRead, false);
  });

  await test("markAllNotificationsRead: empty data marks all remaining own notifications", async () => {
    const unreadBefore = await countNotifications([["recipientUid", advisor.uid], ["isRead", false]]);
    const response = await callCallable("markAllNotificationsRead", {}, advisorToken);
    assert.equal(response.body.result.updatedCount, unreadBefore);
    assert.equal(await countNotifications([["recipientUid", advisor.uid], ["isRead", false]]), 0);
    assert.equal((await db.collection("notifications").doc(`${RUN_ID}-all-other-user`).get()).data().isRead, false);
  });
  await test("markAllNotificationsRead: unauthenticated access fails", async () => {
    const response = await callCallable("markAllNotificationsRead", {});
    assert.equal(response.body.error.status, "UNAUTHENTICATED");
  });

  await test("deterministic IDs prevent retry duplicates and preserve read state", async () => {
    const { createBranchNotifications } = require("../lib/notifications/createBranchNotifications");
    const input = {
      branchId: MAIN_BRANCH, type: "LOW_STOCK", title: "Retry test", message: "Retry test",
      targetType: "PART", targetId: `${RUN_ID}-retry-part`, relatedPartId: `${RUN_ID}-retry-part`,
      sourceEventId: `${RUN_ID}-fixed-event`,
    };
    assert.equal(await createBranchNotifications(input), 3);
    const rows = await notifications([["sourceEventId", input.sourceEventId]]);
    const owned = rows.find((row) => row.recipientUid === advisor.uid);
    await db.collection("notifications").doc(owned.id).update({ isRead: true, readAt: Timestamp.now() });
    assert.equal(await createBranchNotifications(input), 0);
    const after = await notifications([["sourceEventId", input.sourceEventId]]);
    assert.equal(after.length, 3);
    assert.equal(after.find((row) => row.id === owned.id).isRead, true);
    assert.equal(after.some((row) => row.recipientUid === otherAdvisor.uid), false);
  });

  console.log("\nNotification integration result summary");
  console.table(results.map(({ name, status }) => ({ status, test: name })));
  const failures = results.filter((result) => result.status === "FAIL");
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
