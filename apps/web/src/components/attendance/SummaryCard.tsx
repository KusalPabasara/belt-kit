"use client";

type SummaryCardProps = {
  label: string;
  value: string | number;
  tone?: "burgundy" | "green" | "rose" | "amber" | "blue";
  active?: boolean;
  onClick?: () => void;
};

export function SummaryCard({ label, value, tone = "burgundy", active, onClick }: SummaryCardProps) {
  const colorClass = {
    burgundy: "bg-burgundy-50 text-burgundy-700",
    green: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-sky-50 text-sky-700",
  }[tone];

  const content = (
    <>
      <div className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${colorClass}`}>{label}</div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-ink">{value}</div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`rounded-xl border bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-burgundy-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-burgundy-300 ${
          active ? "border-burgundy-300 ring-2 ring-burgundy-50" : "border-line"
        }`}
      >
        {content}
      </button>
    );
  }

  return <div className="rounded-xl border border-line bg-white p-4 shadow-soft">{content}</div>;
}
