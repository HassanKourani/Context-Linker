import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MessageCircleQuestion } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

export function QuestionsNode({ data }: NodeProps) {
  const { bundleId, bundleName, questionCount } = data as {
    bundleId: string;
    bundleName: string;
    questionCount: number;
  };

  const openQuestionsPanel = useUIStore((s) => s.openQuestionsPanel);

  const hasQuestions = questionCount > 0;

  return (
    <div
      className="relative flex items-center justify-center w-10 h-10 rounded-full cursor-pointer transition-transform duration-200 ease-out hover:-translate-y-px hover:scale-105"
      style={{
        background: hasQuestions
          ? "radial-gradient(circle at 30% 25%, rgba(249,226,175,0.25) 0%, rgba(249,226,175,0.08) 60%, rgba(28,28,41,1) 100%)"
          : "linear-gradient(180deg, #25253a 0%, #1c1c29 100%)",
        boxShadow: hasQuestions
          ? "0 0 0 1px rgba(249,226,175,0.45) inset, 0 0 12px rgba(249,226,175,0.2), 0 4px 10px -2px rgba(0,0,0,0.5)"
          : "0 0 0 1px rgba(255,255,255,0.06) inset, 0 4px 10px -2px rgba(0,0,0,0.5)",
        color: hasQuestions ? "#f9e2af" : "var(--muted-foreground)",
      }}
      onClick={(e) => {
        e.stopPropagation();
        openQuestionsPanel(bundleId, bundleName);
      }}
      title={
        hasQuestions
          ? `${questionCount} open question${questionCount === 1 ? "" : "s"}`
          : "No questions asked"
      }
    >
      <Handle
        type="target"
        position={Position.Bottom}
        className="!w-1.5 !h-1.5 !bg-yellow/40 !border-none"
      />
      <MessageCircleQuestion
        className={`w-[18px] h-[18px] ${hasQuestions ? "" : "opacity-40"}`}
        strokeWidth={1.75}
      />
      {hasQuestions && (
        <span
          className="absolute -top-0.5 -right-0.5 text-[9px] font-semibold tabular-nums rounded-full min-w-[16px] h-[16px] px-[3px] flex items-center justify-center"
          style={{
            background: "#f9e2af",
            color: "#11111b",
            boxShadow: "0 0 0 2px #11111b, 0 0 8px rgba(249,226,175,0.5)",
          }}
        >
          {questionCount}
        </span>
      )}
    </div>
  );
}
