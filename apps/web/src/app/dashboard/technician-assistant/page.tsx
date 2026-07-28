"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  ClipboardList,
  FileText,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Package,
  Send,
  ShieldAlert,
  Square,
  Wrench,
} from "lucide-react";
import { where as fsWhere } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/useCollection";
import { createDoc, updateDocById } from "@/lib/db-write";
import {
  AssistantAnswer,
  AssistantAttachment,
  AssistantChat,
  AssistantMessage,
  JobCard,
  Part,
  Vehicle,
} from "@/lib/models";
import { PageHeader, EmptyState, Field } from "@/components/ui";

type PendingAttachment = AssistantAttachment & { dataUrl?: string; text?: string };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

const EXAMPLE_PROMPTS = [
  "The engine light is on and the idle is rough. What should I check first?",
  "What should I inspect before replacing front brake pads?",
  "Which checks should I do before ordering a part for this job?",
];

const THINKING_STEPS = [
  "Reading the job card",
  "Checking the vehicle context",
  "Searching workshop notes",
  "Comparing likely causes",
  "Preparing safe next checks",
];

export default function TechnicianAssistantPage() {
  const { branchId, role, roleResolved } = useAuth();
  const { data: jobs } = useCollection<JobCard>("jobCards");
  const { data: vehicles } = useCollection<Vehicle>("vehicles");
  const { data: parts } = useCollection<Part>("parts");
  const { data: chats } = useCollection<AssistantChat>("assistantChats", [
    fsWhere("ownerUid", "==", auth.currentUser?.uid ?? "__none__"),
  ]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [newChatMode, setNewChatMode] = useState(false);
  const { data: messages, error: messagesError } = useCollection<AssistantMessage>("assistantMessages", [
    fsWhere("ownerUid", "==", auth.currentUser?.uid ?? "__none__"),
    fsWhere("chatId", "==", selectedChatId ?? "__none__"),
  ], false, selectedChatId ?? "__none__");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedJob?.vehicleId) ?? null;
  const availableParts = useMemo(
    () => parts.slice(0, 25).map(({ name, sku, quantityOnHand, lowStock }) => ({ name, sku, quantityOnHand, lowStock })),
    [parts]
  );
  const orderedChats = useMemo(
    () => [...chats].sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0)),
    [chats]
  );
  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0)),
    [messages]
  );

  useEffect(() => {
    if (newChatMode) return;
    if (!selectedChatId && orderedChats[0]) setSelectedChatId(orderedChats[0].id);
    if (selectedChatId && !orderedChats.some((chat) => chat.id === selectedChatId)) setSelectedChatId(null);
  }, [newChatMode, orderedChats, selectedChatId]);

  useEffect(() => {
    if (!sending) return;
    const timer = window.setInterval(() => setThinkingStep((step) => (step + 1) % THINKING_STEPS.length), 1600);
    return () => window.clearInterval(timer);
  }, [sending]);

  if (roleResolved && !(role === "owner" || role === "manager" || role === "advisor" || role === "technician")) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState
          icon={ShieldAlert}
          title="Staff access only"
          hint="This assistant is available to owner, manager, front desk and technician accounts."
        />
      </div>
    );
  }

  function startNewChat() {
    setNewChatMode(true);
    setSelectedChatId(null);
    setDraft("");
    setAttachments([]);
    setError("");
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const next: PendingAttachment[] = [];
    for (const file of files.slice(0, 3)) {
      if (file.size > 6_000_000) {
        setError(`${file.name} is too large. Attachments must be below 6 MB.`);
        continue;
      }
      if (file.type.startsWith("image/")) {
        const dataUrl = await readAsDataUrl(file);
        next.push({ name: file.name, mimeType: file.type, size: file.size, dataUrl });
      } else if (file.type.startsWith("text/") || /\.(txt|md|csv)$/i.test(file.name)) {
        next.push({ name: file.name, mimeType: file.type || "text/plain", size: file.size, text: await file.text() });
      } else {
        next.push({ name: file.name, mimeType: file.type || "application/octet-stream", size: file.size });
      }
    }
    setAttachments((current) => [...current, ...next].slice(0, 3));
  }

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const speechWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRecognitionApi = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      setError("Voice input is not supported by this browser. Try the latest Chrome or Edge.");
      return;
    }
    const recognition = new SpeechRecognitionApi();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.onresult = (event: unknown) => {
      const resultEvent = event as { results: { [index: number]: { [index: number]: { transcript: string } } } };
      const transcript = Array.from(resultEvent.results as unknown as ArrayLike<{ [index: number]: { transcript: string } }>)
        .map((result) => result[0]?.transcript ?? "").join("");
      setDraft(transcript);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function askAssistant(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || sending || !branchId) return;
    setSending(true);
    setThinkingStep(0);
    setError("");
    try {
const token = await auth.currentUser?.getIdToken(true);
      if (!token) throw new Error("Sign in before using the technician assistant.");
      let chatId = selectedChatId;
      if (!chatId) {
        const chat = await createDoc("assistantChats", branchId, {
          ownerUid: auth.currentUser?.uid ?? "unknown",
          title: draft.trim().slice(0, 70),
          lastMessagePreview: draft.trim().slice(0, 120),
        });
        chatId = chat.id;
        setNewChatMode(false);
        setSelectedChatId(chatId);
      }
      const userQuestion = draft.trim();
      const history = orderedMessages.slice(-12).map((item) => ({
        role: item.role,
        content: item.role === "assistant" && item.answer ? JSON.stringify(item.answer) : item.content,
      }));
      await createDoc("assistantMessages", branchId, {
        chatId,
        ownerUid: auth.currentUser?.uid ?? "unknown",
        role: "user",
        content: userQuestion,
        attachments: attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
      });
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: userQuestion,
          history,
          attachments,
          context: {
            job: selectedJob ? { complaint: selectedJob.complaint, status: selectedJob.status } : null,
            vehicle: selectedVehicle ? { make: selectedVehicle.make, model: selectedVehicle.model, year: selectedVehicle.year ?? null, engine: selectedVehicle.engine ?? null, plateNumber: selectedVehicle.plateNumber ?? null } : null,
            parts: availableParts,
          },
        }),
      });
      const body = (await response.json()) as { answer?: AssistantAnswer; sources?: string[]; error?: string };
      if (!response.ok || !body.answer) throw new Error(body.error || "The assistant could not prepare a response.");
      await createDoc("assistantMessages", branchId, {
        chatId,
        ownerUid: auth.currentUser?.uid ?? "unknown",
        role: "assistant",
        content: body.answer.summary,
        answer: body.answer,
        sources: body.sources ?? [],
      });
      await updateDocById("assistantChats", chatId, { lastMessagePreview: body.answer.summary.slice(0, 120) });
      setDraft("");
      setAttachments([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The assistant is unavailable.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Workshop intelligence" title="Technician Assistant" icon={Bot} />
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="card flex max-h-[46rem] flex-col p-3">
          <button onClick={startNewChat} className="btn-primary mb-3 w-full justify-center px-3 py-2 text-xs"><MessageSquarePlus size={15} /> New chat</button>
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Saved chats</p>
          <div className="space-y-1 overflow-y-auto">{orderedChats.length ? orderedChats.map((chat) => <button key={chat.id} onClick={() => { setNewChatMode(false); setSelectedChatId(chat.id); setError(""); }} className={`w-full rounded-xl px-3 py-2.5 text-left transition ${selectedChatId === chat.id && !newChatMode ? "bg-burgundy-50 text-burgundy-700" : "text-ink-soft hover:bg-surface-muted"}`}><p className="line-clamp-2 text-xs font-semibold">{chat.title}</p><p className="mt-1 line-clamp-1 text-[10px] text-ink-faint">{chat.lastMessagePreview}</p></button>) : <p className="px-2 py-4 text-xs text-ink-faint">Your conversations will appear here.</p>}</div>
        </aside>

        <main className="card min-w-0 overflow-hidden">
          <div className="border-b border-line p-6"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-burgundy-50 text-burgundy-600"><Bot size={21} /></div><div><h2 className="font-serif text-xl font-semibold text-ink">Ask about the repair in front of you</h2><p className="mt-1 text-sm text-ink-soft">Follow up in this chat, or start a new conversation for another job.</p></div></div></div>
          <div className="max-h-[34rem] space-y-4 overflow-y-auto bg-surface-muted/30 p-5">{orderedMessages.length ? orderedMessages.map((message) => <MessageBubble key={message.id} message={message} />) : <EmptyState icon={Bot} title="Ready for a technician question" hint="Choose a job card and ask about a symptom, diagnostic check, or repair procedure." />}{sending && <ThinkingPanel step={thinkingStep} />}</div>
          <div className="border-t border-line p-5">
            <div className="mb-4 grid gap-3 md:grid-cols-2"><Field label="Active job card" hint="Select a job card to change the repair context."><select className="input-luxe" value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)}><option value="">No job card selected</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.complaint} · {job.status.replace("_", " ")}</option>)}</select></Field><div className="rounded-xl border border-line bg-surface-muted p-3 text-xs text-ink-soft"><p className="font-semibold text-ink">Context being used</p><p className="mt-1">{selectedVehicle ? `${selectedVehicle.make} ${selectedVehicle.model}${selectedVehicle.plateNumber ? ` · ${selectedVehicle.plateNumber}` : ""}` : selectedJob ? "Vehicle details unavailable for this job" : "No vehicle selected"} · {parts.length} inventory parts</p><p className="mt-1 text-[10px] text-ink-faint">Changes when you select another job card above.</p></div></div>
            {(error || messagesError) && <div className="mb-3 rounded-xl border border-burgundy-200 bg-burgundy-50 p-3 text-sm text-burgundy-700"><span className="flex items-center gap-2 font-semibold"><AlertTriangle size={15} /> {error || messagesError}</span></div>}
            {attachments.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`} className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-soft">{attachment.mimeType.startsWith("image/") ? <ImagePlus size={13} /> : <FileText size={13} />}{attachment.name}<button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="ml-1 text-ink-faint hover:text-burgundy-600">×</button></span>)}</div>}
            <form onSubmit={askAssistant} className="space-y-3"><textarea className="input-luxe min-h-24 resize-y" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask a follow-up or describe a new symptom…" /><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><label className="btn-ghost cursor-pointer px-3 py-2 text-xs"><Paperclip size={15} /> Attach<input type="file" className="hidden" accept="image/*,.pdf,.txt,.md,.csv" multiple onChange={handleFiles} /></label><button type="button" onClick={toggleVoice} className={`btn-ghost px-3 py-2 text-xs ${listening ? "border-rose-300 bg-rose-50 text-rose-700" : ""}`}>{listening ? <Square size={14} /> : <Mic size={15} />} {listening ? "Stop voice" : "Voice"}</button><span className="hidden text-xs text-ink-faint sm:inline">English voice input</span></div><button type="submit" disabled={sending || !draft.trim()} className="btn-primary">{sending ? <><Loader2 size={17} className="animate-spin" /> Thinking…</> : <><Send size={17} /> Ask assistant</>}</button></div></form>
          </div>
        </main>
      </div>
    </div>
  );
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
}

function MessageBubble({ message }: { message: AssistantMessage & { id: string } }) {
  const isUser = message.role === "user";
  return <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}><div className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm ${isUser ? "bg-burgundy-600 text-white" : "border border-line bg-white text-ink"}`}><div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide opacity-70">{isUser ? "You" : "Technician Assistant"}{message.attachments?.length ? ` · ${message.attachments.length} attachment${message.attachments.length > 1 ? "s" : ""}` : ""}</div>{message.answer ? <AnswerContent answer={message.answer} sources={message.sources ?? []} /> : <p className="whitespace-pre-wrap">{message.content}</p>}</div></div>;
}

function AnswerContent({ answer, sources }: { answer: AssistantAnswer; sources: string[] }) {
  return <div><p className="font-medium">{answer.summary}</p>{answer.safetyWarning && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"><strong>Safety:</strong> {answer.safetyWarning}</p>}<div className="mt-3 grid gap-3 sm:grid-cols-2"><AnswerList title="Likely causes" items={answer.likelyCauses} /><AnswerList title="Next checks" items={answer.nextChecks} numbered /></div><div className="mt-3 rounded-lg bg-surface-muted p-2 text-xs"><strong>Follow-up:</strong> {answer.followUpQuestion}</div>{sources.length > 0 && <p className="mt-3 text-[10px] text-ink-faint">References: {sources.join(" · ")}</p>}</div>;
}

function AnswerList({ title, items, numbered = false }: { title: string; items: string[]; numbered?: boolean }) {
  return <div><h3 className="text-xs font-semibold text-ink">{title}</h3><ul className="mt-1.5 space-y-1 text-xs text-ink-soft">{items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-1.5"><span className="font-semibold text-burgundy-600">{numbered ? `${index + 1}.` : "•"}</span>{item}</li>)}</ul></div>;
}

function ThinkingPanel({ step }: { step: number }) {
  return <div className="flex justify-start"><div className="thinking-panel max-w-[92%] rounded-2xl border border-burgundy-100 bg-white px-4 py-3 text-sm text-ink-soft shadow-soft"><div className="flex items-center gap-2"><span className="relative flex h-6 w-6 items-center justify-center"><span className="absolute inset-0 animate-ping rounded-full bg-burgundy-200/60" /><Bot size={14} className="relative text-burgundy-600" /></span><span>{THINKING_STEPS[step]}<span className="thinking-dots">...</span></span></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-burgundy-50"><div className="thinking-progress h-full rounded-full bg-burgundy-500" /></div></div></div>;
}
