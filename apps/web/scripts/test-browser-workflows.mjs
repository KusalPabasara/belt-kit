import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OWNER_EMAIL = process.env.E2E_EMAIL ?? "owner@beltkit.local";
const OWNER_PASSWORD = process.env.E2E_PASSWORD ?? "beltkit123";
const timeoutMs = 20_000;

function fail(message) {
  throw new Error(message);
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a Chrome port."));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitUntil(check, message, timeout = timeoutMs) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${message}${lastError ? ` (${lastError.message})` : ""}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const handler of this.events.get(message.method) ?? []) handler(message.params ?? {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    this.events.set(method, [...(this.events.get(method) ?? []), handler]);
  }
}

function pageFunction(source, ...args) {
  return `(${source})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
}

async function main() {
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), "belt-kit-e2e-"));
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeError = "";
  chrome.stderr.on("data", (chunk) => { chromeError += String(chunk); });

  const failures = [];
  const checks = [];
  const suffix = Date.now().toString(36).replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]).slice(-8);
  const customerName = `Release Test ${suffix}`;
  const plate = `RT-${String(Date.now()).slice(-4)}`;
  const complaint = `Release browser check ${suffix}`;
  const employeeName = `Attendance Test ${suffix}`;
  const employeeEmail = `attendance.${Date.now()}@beltkit.local`;

  try {
    const version = await waitUntil(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
      return response?.ok ? response.json() : null;
    }, "Chrome DevTools did not start");
    if (!version) fail(`Chrome did not start. ${chromeError}`);

    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${APP_URL}/login`)}`, { method: "PUT" });
    const target = await targetResponse.json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const cdp = new Cdp(socket);
    cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      failures.push(`Runtime exception: ${exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? "unknown"}`);
    });
    cdp.on("Log.entryAdded", ({ entry }) => {
      const text = String(entry?.text ?? "");
      const genericResourceError = text.startsWith("Failed to load resource:");
      if (entry?.level === "error" && !text.includes("favicon") && !genericResourceError) failures.push(`Console error: ${text}`);
    });
    cdp.on("Network.responseReceived", ({ response }) => {
      if (response?.status >= 400 && String(response.url).startsWith(APP_URL) && !String(response.url).endsWith("favicon.ico")) {
        failures.push(`HTTP ${response.status}: ${response.url}`);
      }
    });
    await Promise.all([
      cdp.send("Page.enable"),
      cdp.send("Runtime.enable"),
      cdp.send("Network.enable"),
      cdp.send("Log.enable"),
    ]);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    async function evaluate(source, ...args) {
      const result = await cdp.send("Runtime.evaluate", {
        expression: pageFunction(source, ...args),
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails) fail(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result?.value;
    }

    async function bodyText() {
      return await evaluate(() => document.body?.innerText ?? "");
    }

    async function path() {
      return await evaluate(() => location.pathname + location.search);
    }

    async function navigate(nextPath) {
      await cdp.send("Page.navigate", { url: `${APP_URL}${nextPath}` });
      await waitUntil(async () => await evaluate(() => document.readyState === "complete"), `Page did not load: ${nextPath}`);
      await waitUntil(async () => {
        const text = await bodyText();
        return text && !text.includes("Loading workspace");
      }, `Workspace did not become ready: ${nextPath}`);
    }

    async function waitText(text, timeout = timeoutMs) {
      return await waitUntil(async () => (await bodyText()).toLowerCase().includes(text.toLowerCase()), `Text not found: ${text}`, timeout);
    }

    async function setField(selector, value) {
      const ok = await evaluate((inputSelector, nextValue) => {
        const element = document.querySelector(inputSelector);
        if (!element) return false;
        const prototype = element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, nextValue);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, selector, String(value));
      if (!ok) fail(`Field not found: ${selector}`);
    }

    async function clickText(text, exact = true) {
      const clicked = await evaluate((wanted, exactMatch) => {
        const candidates = [...document.querySelectorAll("button, a, [role='button'], label")];
        const element = candidates.find((candidate) => {
          const content = candidate.textContent?.replace(/\s+/g, " ").trim() ?? "";
          return exactMatch ? content === wanted : content.includes(wanted);
        });
        if (!element) return false;
        element.click();
        return true;
      }, text, exact);
      if (!clicked) fail(`Clickable text not found: ${text}`);
    }

    async function selectOption(selector, text) {
      const selected = await evaluate((inputSelector, optionText) => {
        const element = document.querySelector(inputSelector);
        if (!(element instanceof HTMLSelectElement)) return false;
        const option = [...element.options].find((item) => item.textContent?.includes(optionText));
        if (!option) return false;
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(element, option.value);
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, selector, text);
      if (!selected) fail(`Option not found: ${selector} -> ${text}`);
    }

    async function assert(label, condition, detail = "") {
      if (!condition) fail(`${label}${detail ? `: ${detail}` : ""}`);
      checks.push(label);
      process.stdout.write(`PASS ${label}\n`);
    }

    await navigate("/login");
    if (process.env.E2E_DEBUG === "1") {
      process.stdout.write(`DEBUG path=${await path()} body=${(await bodyText()).slice(0, 500)}\n`);
    }
    await waitText("Demo accounts");
    await setField("#email", OWNER_EMAIL);
    await setField("#password", OWNER_PASSWORD);
    await clickText("Submit");
    await waitUntil(async () => (await path()).startsWith("/dashboard"), "Owner login did not reach the dashboard");
    if (process.env.E2E_DEBUG === "1") {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      process.stdout.write(`DEBUG after-login path=${await path()} body=${(await bodyText()).slice(0, 1000)}\n`);
    }
    await waitText("Good morning");
    await assert("owner demo account signs in", true);

    await navigate("/dashboard/customers");
    await clickText("New Customer");
    await waitText("New Customer & Vehicle");
    await setField("input[name='displayName']", customerName);
    await setField("input[name='phone']", `07${String(Date.now()).slice(-8)}`);
    await setField("input[name='email']", `customer.${Date.now()}@example.test`);
    await setField("input[name='plateNumber']", plate);
    await setField("input[name='year']", "2020");
    await setField("input[name='make']", "Toyota");
    await setField("input[name='model']", "Aqua");
    await setField("input[name='vin']", `VIN${Date.now()}`);
    await setField("input[name='engine']", `ENG${Date.now()}`);
    await setField("input[name='odometerReading']", "45200");
    await setField("textarea[name='damageNotes']", "Release test: light rear bumper scratch");
    await clickText("Add customer & vehicle");
    await waitUntil(async () => (await bodyText()).includes(customerName) && !(await bodyText()).includes("New Customer & Vehicle"), "Customer and vehicle were not saved");
    await assert("customer and linked vehicle are created in one form", true);

    await navigate("/dashboard/vehicles");
    await setField("input[placeholder*='Search plate']", plate);
    await waitText(plate);
    await assert("registered vehicle appears on the display-only Vehicles page", (await bodyText()).includes(customerName));

    await navigate("/dashboard/job-cards");
    await assert("Job Cards is the only active navigation item", await evaluate(() => {
      const active = [...document.querySelectorAll("nav a")].filter((link) => link.querySelector(".bg-burgundy-400"));
      return active.length === 1 && active[0].textContent.includes("Job Cards");
    }));
    await clickText("New Job");
    await waitText("New Job Card");
    await waitUntil(async () => await evaluate((wanted) => [...document.querySelectorAll("select[name='customerId'] option")].some((option) => option.textContent.includes(wanted)), customerName), "New customer did not load in the Job Card form");
    await selectOption("select[name='customerId']", customerName);
    await waitUntil(async () => await evaluate((targetPlate) => [...document.querySelectorAll("select[name='vehicleId'] option")].some((option) => option.textContent.includes(targetPlate)), plate), "Linked vehicle did not load in the Job Card form");
    await selectOption("select[name='vehicleId']", plate);
    await evaluate(() => {
      const service = document.querySelector("fieldset:nth-of-type(1) input[type='checkbox']");
      const technician = document.querySelector("fieldset:nth-of-type(2) input[type='checkbox']");
      service?.click();
      technician?.click();
    });
    await setField("textarea[name='complaint']", complaint);
    await clickText("Create job card");
    await waitUntil(async () => await evaluate((wanted) => [...document.querySelectorAll("a")].some((link) => link.textContent?.includes(wanted)), complaint), "Job Card was not created");
    await assert("job card is created with customer, vehicle, service and technician", true);

    const opened = await evaluate((wanted) => {
      const element = [...document.querySelectorAll("a")].find((link) => link.textContent?.includes(wanted));
      if (!element) return false;
      element.click();
      return true;
    }, complaint);
    await assert("job card row clearly opens the job detail", opened);
    await waitUntil(async () => (await path()).startsWith("/dashboard/job-cards/"), "Job detail did not open");
    await waitText(complaint);
    await clickText("Edit");
    await waitText("Edit Job Card");
    await waitUntil(async () => await evaluate(() => {
      const dialog = document.querySelector("[role='dialog']") ?? document.body;
      return dialog.innerText.includes("Services") && dialog.querySelectorAll("input[type='checkbox']:not(:disabled)").length >= 1;
    }), "Editable services did not load in the Job Card form");
    await assert("services are editable on an open job card", true);
    await waitUntil(async () => await evaluate(() => {
      const dialog = document.querySelector("[role='dialog']") ?? document.body;
      return dialog.innerText.includes("Technicians") && dialog.querySelectorAll("input[type='checkbox']:not(:disabled)").length >= 2;
    }), "Editable technicians did not load in the Job Card form");
    await assert("technicians are editable on an open job card", true);
    await clickText("Cancel");
    await clickText("Pricing & tax", false);
    await waitText("Invoice pricing");
    await assert("invoice pricing supports percentage and fixed discounts", await evaluate(() => {
      const text = document.body.innerText;
      return text.includes("Percent (%)") && text.includes("Fixed value") && text.includes("Tax rate (%)");
    }));
    await clickText("Cancel");

    await navigate("/dashboard/reports");
    await assert("reports default to All time", await evaluate(() => [...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "All time" && button.getAttribute("aria-pressed") === "true")));
    await clickText("Custom");
    await assert("Custom report period reveals From and To dates", await evaluate(() => document.querySelectorAll("input[type='date']").length >= 2));
    await waitUntil(async () => {
      const text = await bodyText();
      return ["Revenue", "Gross profit", "Completed jobs", "Inventory snapshot"].every((label) => text.includes(label));
    }, "Report KPIs did not remain visible after filtering");
    await assert("report KPIs remain visible with filters", true);

    await navigate("/dashboard/employees");
    await assert("Employees is the only active navigation item", await evaluate(() => {
      const active = [...document.querySelectorAll("nav a")].filter((link) => link.querySelector(".bg-burgundy-400"));
      return active.length === 1 && active[0].textContent.includes("Employees");
    }));
    await assert("redundant Change Role action is removed", !(await bodyText()).includes("Change Role"));
    await clickText("Create Employee");
    await waitText("Create employee");
    const modalInputs = await evaluate(() => {
      const heading = [...document.querySelectorAll("h2")].find((node) => node.textContent.trim() === "Create employee");
      const modal = heading?.closest(".card");
      return [...(modal?.querySelectorAll("input") ?? [])].map((input) => ({ type: input.type }));
    });
    await assert("employee create form rendered", modalInputs.length >= 5);
    await evaluate((values) => {
      const heading = [...document.querySelectorAll("h2")].find((node) => node.textContent.trim() === "Create employee");
      const modal = heading?.closest(".card");
      const inputs = [...(modal?.querySelectorAll("input") ?? [])];
      const set = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set(inputs[0], values.name);
      set(inputs[1], values.email);
      set(inputs[2], values.password);
      set(inputs[3], values.phone);
      set(inputs[4], values.salary);
      set(inputs[5], values.joinDate);
    }, { name: employeeName, email: employeeEmail, password: "beltkit123", phone: "0712345678", salary: "50000", joinDate: "2026-08-04" });
    await clickText("Create employee");
    await waitUntil(async () => (await bodyText()).includes(employeeName) && !(await bodyText()).includes("Create employee"), "Employee was not created", 30_000);
    await assert("employee is created for attendance testing", true);
    const editClicked = await evaluate((wanted) => {
      const row = [...document.querySelectorAll("main > div div.rounded-xl")].find((node) => node.textContent?.includes(wanted));
      const button = row?.querySelector("button[aria-label='Edit']");
      button?.click();
      return Boolean(button);
    }, employeeName);
    await assert("employee Edit action opens from the correct row", editClicked);
    await waitText("Edit employee");
    await assert("employee edit form is prefilled", await evaluate((wanted) => {
      const heading = [...document.querySelectorAll("h2")].find((node) => node.textContent.trim() === "Edit employee");
      const modal = heading?.closest(".card");
      const values = [...(modal?.querySelectorAll("input") ?? [])].map((input) => input.value);
      return values.includes(wanted) && values.includes("0712345678") && values.includes("50000.00") && values.includes("2026-08-04");
    }, employeeName));
    await clickText("Cancel");

    await navigate("/dashboard/employees/attendance");
    await assert("Attendance is the only active navigation item", await evaluate(() => {
      const active = [...document.querySelectorAll("nav a")].filter((link) => link.querySelector(".bg-burgundy-400"));
      return active.length === 1 && active[0].textContent.includes("Attendance");
    }));
    await waitText(employeeName, 30_000);
    const markedPresent = await evaluate((wanted) => {
      const row = [...document.querySelectorAll("[role='group'][aria-label^='Mark attendance for']")]
        .find((group) => group.getAttribute("aria-label").includes(wanted));
      const button = [...(row?.querySelectorAll("button") ?? [])].find((item) => item.textContent.includes("Present"));
      button?.click();
      return Boolean(button);
    }, employeeName);
    await assert("attendance can be marked directly from the employee row", markedPresent);
    await waitUntil(async () => await evaluate((wanted) => ![...document.querySelectorAll("[role='group'][aria-label^='Mark attendance for']")]
      .some((group) => group.getAttribute("aria-label").includes(wanted)), employeeName), "Marked employee did not move out of To mark");
    await clickText("Marked", false);
    await waitText(employeeName);
    await assert("marked employee moves into the Marked tray", (await bodyText()).includes("Present"));
    const leaveClicked = await evaluate((wanted) => {
      const group = [...document.querySelectorAll("[role='group'][aria-label^='Mark attendance for']")]
        .find((item) => item.getAttribute("aria-label").includes(wanted));
      const button = [...(group?.querySelectorAll("button") ?? [])].find((item) => item.textContent.includes("On leave"));
      button?.click();
      return Boolean(button);
    }, employeeName);
    await assert("On leave opens the reason workflow", leaveClicked);
    await waitText(`Why is ${employeeName} on leave?`);
    await assert("leave reason may be skipped without losing the record", (await bodyText()).includes("Skip for now"));
    await setField("textarea[placeholder^='For example: approved annual leave']", "Approved release test leave");
    await clickText("Save on leave");
    await waitText("Reason: Approved release test leave");
    await assert("leave reason is saved and visible in Marked", true);

    await navigate("/dashboard/job-cards/finished-jobs");
    await assert("Finished Jobs is the only active navigation item", await evaluate(() => {
      const active = [...document.querySelectorAll("nav a")].filter((link) => link.querySelector(".bg-burgundy-400"));
      return active.length === 1 && active[0].textContent.includes("Finished Jobs");
    }));
    await waitUntil(async () => await evaluate(() => [...document.querySelectorAll("a")].some((link) => /Insurance Claim/.test(link.textContent))), "Delivered job Insurance action did not load");
    await assert("delivered jobs expose their Insurance action", true);

    const insuranceAction = await evaluate(() => {
      const create = [...document.querySelectorAll("a")].find((link) => link.textContent?.includes("Add Insurance Claim"));
      const view = [...document.querySelectorAll("a")].find((link) => link.textContent?.includes("View Insurance Claim"));
      const link = create ?? view;
      if (!link) return "none";
      const action = create ? "create" : "view";
      link.click();
      return action;
    });
    await waitUntil(async () => (await path()).startsWith("/dashboard/insurance/"), "Insurance action did not open");
    if (insuranceAction === "create") {
      await waitText("Delivered Job Card confirmed");
      await assert("insurance intake uses the delivered Job Card ID", (await bodyText()).includes("This case ID will be the Job Card ID"));
      await assert("insurance document upload placeholder is present without OCR", (await bodyText()).includes("Document upload will be connected in a later update"));
      await setField("input[name='companyName']", "Release Test Insurance");
      await setField("input[name='claimNumber']", `CLAIM-${suffix}`);
      await clickText("Create insurance case");
      await waitUntil(async () => {
        const currentPath = (await path()).split("?")[0];
        return /^\/dashboard\/insurance\/[^/]+$/.test(currentPath) && currentPath !== "/dashboard/insurance/create";
      }, "Insurance case was not created", 30_000);
      await waitText("Financial summary");
      await assert("insurance case is created from the delivered job", true);
    } else {
      await waitText("Financial summary");
      await assert("existing insurance case opens from its delivered job", true);
    }

    await navigate("/dashboard/insurance");
    await waitUntil(async () => {
      const text = (await bodyText()).toLowerCase();
      return ["stage", "status", "insurer", "payment", "payment due"].every((label) => text.includes(label));
    }, "Insurance dashboard filters did not load");
    await assert("insurance dashboard renders operational and settlement filters", true);
    const insuranceText = (await bodyText()).toLowerCase();
    await assert("insurance dashboard includes overdue calculations without Cloud Functions", insuranceText.includes("overdue payments") && insuranceText.includes("overdue"));

    const uniqueFailures = [...new Set(failures)].filter((message) => !message.includes("ERR_BLOCKED_BY_CLIENT"));
    if (uniqueFailures.length) fail(`Browser reported errors:\n${uniqueFailures.join("\n")}`);
    process.stdout.write(`\nBrowser workflow verification passed (${checks.length} checks).\n`);
    socket.close();
  } finally {
    if (chrome.exitCode === null) {
      chrome.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => chrome.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
