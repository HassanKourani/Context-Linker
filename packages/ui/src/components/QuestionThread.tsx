import { CheckCircle, CircleDot, MessageCircle, Reply } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QuestionData } from "@/types";

const statusStyles = {
  open: "bg-yellow/20 text-yellow border-yellow/30",
  answered: "bg-blue/20 text-blue border-blue/30",
  resolved: "bg-green/20 text-green border-green/30",
};

const statusIcons = {
  open: CircleDot,
  answered: MessageCircle,
  resolved: CheckCircle,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface Props {
  question: QuestionData;
  onResolve?: () => void;
}

export function QuestionThread({ question, onResolve }: Props) {
  const StatusIcon = statusIcons[question.status];

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Question header */}
      <div className="bg-card px-3 py-2.5">
        <div className="flex items-start gap-2">
          <StatusIcon className={`w-4 h-4 mt-0.5 shrink-0 ${
            question.status === "open" ? "text-yellow" :
            question.status === "answered" ? "text-blue" : "text-green"
          }`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground leading-snug">
              {question.question}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground">
                from <span className="text-foreground/80 font-medium">{question.asked_by_project}</span>
              </span>
              {question.target_project && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">
                  → {question.target_project}
                </span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusStyles[question.status]}`}>
                {question.status}
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                {relativeTime(question.created_at)}
              </span>
            </div>
            {question.context && (
              <p className="text-[11px] text-muted-foreground mt-1.5 italic">
                Context: {question.context}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Answers */}
      {question.answers.length > 0 && (
        <div className="border-t border-border">
          {question.answers.map((answer) => (
            <div key={answer.id} className="px-3 py-2 bg-accent/30 border-b border-border last:border-b-0">
              <div className="flex items-start gap-2 pl-3">
                <Reply className="w-3 h-3 mt-1 shrink-0 text-blue/60" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground leading-snug">
                    {answer.answer}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted-foreground">
                      by <span className="text-foreground/80 font-medium">{answer.answered_by_project}</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {relativeTime(answer.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resolve button */}
      {onResolve && (
        <div className="border-t border-border px-3 py-1.5 bg-card">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] text-green hover:text-green"
            onClick={onResolve}
          >
            <CheckCircle className="w-3 h-3 mr-1" />
            Mark resolved
          </Button>
        </div>
      )}

      {/* Loading indicator for open questions */}
      {question.status === "open" && question.answers.length === 0 && (
        <div className="border-t border-border px-3 py-2 bg-accent/20">
          <div className="flex items-center gap-2 pl-3">
            <div className="w-3 h-3 rounded-full border-2 border-yellow/40 border-t-yellow animate-spin" />
            <span className="text-[10px] text-muted-foreground">Waiting for answer...</span>
          </div>
        </div>
      )}
    </div>
  );
}
