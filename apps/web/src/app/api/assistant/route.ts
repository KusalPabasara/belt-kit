import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { WORKSHOP_KNOWLEDGE } from "@/lib/assistant-knowledge";
import { verifyTechnicianToken } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Technician Assistant — powered by Groq (free tier, no card, works on a
 * deployed site — unlike local Ollama). Groq exposes an OpenAI-compatible API.
 *
 * Set GROQ_API_KEY in the environment (get one free at https://console.groq.com).
 * Optionally override the model with GROQ_MODEL.
 *
 * Note: Groq's free tier is TEXT-ONLY, so image attachments are ignored here
 * (text repair questions work fully). To keep image support, use a vision
 * provider instead.
 */

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const inputSchema = z.object({
  message: z.string().trim().min(2).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(5000) }))
    .max(12)
    .default([]),
  attachments: z
    .array(
      z.object({
        name: z.string().max(160),
        mimeType: z.string().max(100),
        size: z.number().max(6_000_000),
        dataUrl: z.string().max(8_000_000).optional(),
        text: z.string().max(20_000).optional(),
      })
    )
    .max(3)
    .default([]),
  context: z.object({
    job: z
      .object({
        complaint: z.string().max(1000),
        status: z.string().max(100),
      })
      .nullable()
      .optional(),
    vehicle: z
      .object({
        make: z.string().max(100),
        model: z.string().max(100),
        year: z.number().nullable().optional(),
        engine: z.string().max(200).nullable().optional(),
        plateNumber: z.string().max(50).nullable().optional(),
      })
      .nullable()
      .optional(),
    parts: z
      .array(
        z.object({
          name: z.string().max(200),
          sku: z.string().max(100),
          quantityOnHand: z.number(),
          lowStock: z.boolean(),
        })
      )
      .max(50)
      .default([]),
  }),
});

/**
 * Lightweight keyword retrieval over the workshop knowledge base (no embedding
 * API needed). Returns up to 3 of the most relevant reference notes.
 */
function retrieveKnowledge(question: string) {
  const words = new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
  return WORKSHOP_KNOWLEDGE.map((article) => {
    const haystack = `${article.title} ${article.content}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (haystack.includes(w)) score += 1;
    }
    return { article, score };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter((r) => r.score > 0)
    .map((r) => r.article);
}

/** Extract the first {...} JSON object from a model text response. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response.");
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "Sign in before using the technician assistant." }, { status: 401 });
  }
  try {
    await verifyTechnicianToken(token);
  } catch (error) {
    if (error instanceof Error && error.message === "TECHNICIAN_ONLY") {
      return NextResponse.json({ error: "The Technician Assistant is available only to staff accounts." }, { status: 403 });
    }
    return NextResponse.json({ error: "Your session is not valid. Sign in again before using the assistant." }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "The assistant is not configured. Add GROQ_API_KEY to enable it." },
      { status: 503 }
    );
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a technician question and valid vehicle context." }, { status: 400 });
  }

  try {
    const sources = retrieveKnowledge(parsed.data.message);
    const context = parsed.data.context;

    const textAttachments = parsed.data.attachments
      .filter((a) => a.text)
      .map((a) => `Attachment: ${a.name}\n${a.text}`)
      .join("\n\n");
    const hasImages = parsed.data.attachments.some((a) => a.mimeType.startsWith("image/"));

    const systemInstruction = `You are Belt-Kit Technician Assistant. Help a trained automotive technician think through a repair. Use the supplied job, vehicle, inventory and retrieved reference notes. Do not invent torque specifications, part compatibility, measurements, or completed tests. State uncertainty and ask one useful follow-up. Never instruct unsafe work; escalate high-voltage, braking, fuel, lifting, or overheating risks. Do not claim to have performed any action.

Return ONLY a JSON object with exactly these keys:
{"summary": string, "urgency": "routine"|"soon"|"stop_and_inspect", "likelyCauses": string[], "nextChecks": string[], "toolsOrParts": string[], "safetyWarning": string|null, "followUpQuestion": string}
No prose outside the JSON.`;

    // Build the conversation as OpenAI-compatible messages (Groq).
    const history = parsed.data.history.map((item) => ({
      role: item.role,
      content: item.content,
    }));

    const userPayload = JSON.stringify({
      technicianQuestion: parsed.data.message,
      activeJob: context.job ?? "No active job card selected",
      vehicle: context.vehicle ?? "No vehicle selected",
      inventory: context.parts,
      attachments: textAttachments || "No text attachments",
      // Groq free tier is text-only; note images so the model can ask for a
      // written description instead of silently ignoring them.
      imageNote: hasImages
        ? "The technician attached a photo, but this assistant cannot view images. Ask them to describe what they see."
        : undefined,
      retrievedReferenceNotes: sources.map((s) => ({ title: s.title, content: s.content })),
    });

    const body = {
      model: GROQ_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" as const },
      messages: [
        { role: "system", content: systemInstruction },
        ...history,
        { role: "user", content: userPayload },
      ],
    };

    const callGroq = () =>
      fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

    // Try once; if we hit a transient rate-limit (429), wait briefly and retry
    // a single time so short free-tier spikes stay invisible to the user.
    let res = await callGroq();
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 3000));
      res = await callGroq();
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const quota = res.status === 429;
      return NextResponse.json(
        {
          error: quota
            ? "The assistant hit its free-tier rate limit. Wait a minute and try again."
            : `The assistant service returned an error (${res.status}). ${errText.slice(0, 200)}`,
        },
        { status: 503 }
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      return NextResponse.json(
        { error: "The assistant returned an empty response. Try rephrasing your question." },
        { status: 503 }
      );
    }

    // Parse leniently: coerce/fill missing fields so a slightly-off model
    // response still renders instead of failing the whole request.
    const raw = extractJson(text) as Record<string, unknown>;
    const asStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
    const summary = typeof raw.summary === "string" && raw.summary.trim()
      ? raw.summary
      : typeof (raw as { answer?: string }).answer === "string"
        ? String((raw as { answer?: string }).answer)
        : text.slice(0, 500);
    const nextChecks = asStringArray(raw.nextChecks);
    const answer = {
      summary,
      urgency: (["routine", "soon", "stop_and_inspect"] as const).includes(raw.urgency as never)
        ? (raw.urgency as "routine" | "soon" | "stop_and_inspect")
        : "routine",
      likelyCauses: asStringArray(raw.likelyCauses).slice(0, 4),
      nextChecks: nextChecks.length ? nextChecks.slice(0, 6) : ["Review the symptom and inspect the related system."],
      toolsOrParts: asStringArray(raw.toolsOrParts).slice(0, 6),
      safetyWarning:
        typeof raw.safetyWarning === "string" && raw.safetyWarning.trim() ? raw.safetyWarning : null,
      followUpQuestion:
        typeof raw.followUpQuestion === "string" ? raw.followUpQuestion : "Anything else about this vehicle?",
    };
    return NextResponse.json({ answer, sources: sources.map((s) => s.title) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The assistant service is unavailable.";
    return NextResponse.json(
      { error: `The assistant could not complete your request. ${message.slice(0, 200)}` },
      { status: 503 }
    );
  }
}
