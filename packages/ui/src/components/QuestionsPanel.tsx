import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, MessageCircleQuestion, RefreshCw, X } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useQuestions } from "@/hooks/useQuestions";
import { useResolveQuestion } from "@/hooks/mutations/useResolveQuestion";
import { QuestionThread } from "./QuestionThread";

type FilterTab = "all" | "open" | "resolved";

export function QuestionsPanel() {
  const panel = useUIStore((s) => s.panel);
  const closePanel = useUIStore((s) => s.closePanel);
  const isQuestions = panel?.kind === "questions";
  const bundleId = isQuestions ? panel.bundleId : null;
  const bundleName = isQuestions ? panel.bundleName : "";

  const [filter, setFilter] = useState<FilterTab>("all");
  const statusParam = filter === "all" ? undefined : filter;
  const { data: questions, isLoading, refetch } = useQuestions(bundleId, statusParam);
  const resolveMutation = useResolveQuestion();

  const open = isQuestions;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closePanel()}>
      <SheetContent
        side="right"
        className="w-[420px] bg-card border-l border-border p-0 flex flex-col [&>button]:hidden"
      >
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <MessageCircleQuestion className="w-4 h-4 text-yellow shrink-0" />
              <SheetTitle className="text-sm font-semibold truncate">
                {bundleName}
              </SheetTitle>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => refetch()}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={closePanel}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <SheetDescription className="text-xs text-muted-foreground">
            {questions?.length ?? 0} question{(questions?.length ?? 0) === 1 ? "" : "s"}
          </SheetDescription>
        </SheetHeader>

        {/* Filter tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-border shrink-0">
          {(["all", "open", "resolved"] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filter === tab
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Loading...
            </div>
          )}
          {!isLoading && (!questions || questions.length === 0) && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No questions{filter !== "all" ? ` (${filter})` : ""}.
            </div>
          )}
          {questions?.map((q) => (
            <QuestionThread
              key={q.id}
              question={q}
              onResolve={
                q.status === "answered"
                  ? () => resolveMutation.mutate({ bundleId: bundleId!, questionId: q.id })
                  : undefined
              }
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
