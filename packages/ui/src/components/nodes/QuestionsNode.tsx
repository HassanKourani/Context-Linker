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
      className={`flex items-center justify-center w-10 h-10 rounded-full border-2 shadow-md cursor-pointer transition-all hover:scale-110 ${
        hasQuestions
          ? "bg-yellow/20 border-yellow text-yellow"
          : "bg-card border-border text-muted-foreground"
      }`}
      onClick={(e) => {
        e.stopPropagation();
        openQuestionsPanel(bundleId, bundleName);
      }}
      title={hasQuestions ? `${questionCount} open question${questionCount === 1 ? "" : "s"}` : "No questions asked"}
    >
      <Handle
        type="target"
        position={Position.Bottom}
        className="!w-1.5 !h-1.5 !bg-yellow/40 !border-none"
      />
      <div className="flex flex-col items-center">
        <MessageCircleQuestion className={`w-4 h-4 ${hasQuestions ? "" : "opacity-40"}`} />
        {hasQuestions && (
          <span className="absolute -bottom-0.5 -right-0.5 text-[8px] font-bold bg-yellow text-crust rounded-full w-3.5 h-3.5 flex items-center justify-center">
            {questionCount}
          </span>
        )}
      </div>
    </div>
  );
}
