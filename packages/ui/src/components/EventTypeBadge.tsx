import { GitCommit, GitPullRequest, PenLine, LogOut } from "lucide-react";

const config: Record<string, { icon: React.ElementType; label: string; className: string }> = {
  commit: { icon: GitCommit, label: "Commit", className: "bg-[#89b4fa]/15 text-[#89b4fa]" },
  pr_open: { icon: GitPullRequest, label: "PR", className: "bg-[#a6e3a1]/15 text-[#a6e3a1]" },
  manual: { icon: PenLine, label: "Manual", className: "bg-[#f9e2af]/15 text-[#f9e2af]" },
  session_end: { icon: LogOut, label: "Session", className: "bg-[#f38ba8]/15 text-[#f38ba8]" },
};

export function EventTypeBadge({ type }: { type: string }) {
  const c = config[type] ?? config.manual;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${c.className}`}>
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  );
}
