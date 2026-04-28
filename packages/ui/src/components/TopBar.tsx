import { Plus, Users, EyeOff, Eye, LayoutGrid, MessageCircleQuestion, Radio, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useSignOut } from "@/hooks/useAuth";

interface TopBarProps {
  machineId: string | undefined;
  userEmail: string | null;
  isLoading: boolean;
  dataUpdatedAt: number;
  onTidyUp?: () => void;
}

export function TopBar({ machineId, userEmail, isLoading, dataUpdatedAt, onTidyUp }: TopBarProps) {
  const signOut = useSignOut();
  const openModal = useUIStore((s) => s.openModal);
  const openFeedPanel = useUIStore((s) => s.openFeedPanel);
  const hideEmptySessions = useUIStore((s) => s.hideEmptySessions);
  const toggleHideEmptySessions = useUIStore((s) => s.toggleHideEmptySessions);
  const hideEmptyQuestions = useUIStore((s) => s.hideEmptyQuestions);
  const toggleHideEmptyQuestions = useUIStore((s) => s.toggleHideEmptyQuestions);
  const lastRefresh = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : "—";

  return (
    <div className="h-12 bg-[#181825] border-b border-border flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-foreground tracking-wide">
          ctx-link
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => openModal("create-bundle")}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Bundle
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => openModal("team-management")}
          >
            <Users className="w-3.5 h-3.5 mr-1" />
            Teams
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={onTidyUp}
            title="Reset layout to auto-arranged positions"
          >
            <LayoutGrid className="w-3.5 h-3.5 mr-1" />
            Tidy up
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => openFeedPanel()}
          >
            <Radio className="w-3.5 h-3.5 mr-1" />
            Live Feed
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          className={`text-xs ${hideEmptySessions ? "text-foreground" : "text-muted-foreground"} hover:text-foreground`}
          onClick={toggleHideEmptySessions}
          title={hideEmptySessions ? "Show empty sessions" : "Hide empty sessions"}
        >
          {hideEmptySessions ? <EyeOff className="w-3.5 h-3.5 mr-1" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
          Empty sessions
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={`text-xs ${hideEmptyQuestions ? "text-foreground" : "text-muted-foreground"} hover:text-foreground`}
          onClick={toggleHideEmptyQuestions}
          title={hideEmptyQuestions ? "Show empty question nodes" : "Hide empty question nodes"}
        >
          <MessageCircleQuestion className={`w-3.5 h-3.5 mr-1 ${hideEmptyQuestions ? "opacity-50" : ""}`} />
          Empty Q&A
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
          <span
            className={`w-2 h-2 rounded-full ${isLoading ? "bg-[#f9e2af] animate-pulse" : "bg-[#a6e3a1]"}`}
          />
          <span>{lastRefresh}</span>
        </div>
        {machineId && (
          <span className="font-mono text-xs text-muted-foreground bg-card px-2 py-1 rounded">
            {machineId.slice(0, 8)}
          </span>
        )}
        {userEmail && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground" title={userEmail}>
              {userEmail}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
