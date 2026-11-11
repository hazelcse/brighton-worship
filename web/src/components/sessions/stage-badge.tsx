import { STAGE_LABEL, type BuildStage } from "@/lib/session-plan";

const STYLE: Record<BuildStage, string> = {
  not_started: "border-border bg-background text-muted",
  draft: "border-amber-300 bg-amber-50 text-amber-800",
  published: "border-emerald-300 bg-emerald-50 text-emerald-800",
};

export function StageBadge({ stage }: { stage: BuildStage }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STYLE[stage]}`}>
      {STAGE_LABEL[stage]}
    </span>
  );
}
