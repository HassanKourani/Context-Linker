import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/uiStore";
import { useDeleteSession } from "@/hooks/mutations/useDeleteSession";
import { usePushSessionToBundle } from "@/hooks/mutations/usePushSessionToBundle";
import { ArrowRight, Unlink } from "lucide-react";

export function EdgeActionDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const pending = useUIStore((s) => s.pendingEdgeAction);
  const open = activeModal === "edge-action" && !!pending;

  const unlinkMutation = useDeleteSession();
  const pushMutation = usePushSessionToBundle();

  const isBusy = unlinkMutation.isPending || pushMutation.isPending;

  const handlePush = () => {
    if (!pending) return;
    pushMutation.mutate(
      { sessionId: pending.sessionId, bundle_id: pending.bundleId },
      { onSuccess: () => closeModal() }
    );
  };

  const handleUnlink = () => {
    if (!pending) return;
    unlinkMutation.mutate(
      { session_id: pending.sessionId, bundle_id: pending.bundleId },
      { onSuccess: () => closeModal() }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session Link</DialogTitle>
          <DialogDescription>
            Choose an action for this connection.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          <button
            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#313244] hover:border-[#a6e3a1]/50 hover:bg-[#a6e3a1]/10 transition-colors text-left cursor-pointer disabled:opacity-50"
            onClick={handlePush}
            disabled={isBusy}
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-[#a6e3a1]/15 text-[#a6e3a1]">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-medium text-[#cdd6f4]">
                {pushMutation.isPending ? "Pushing..." : "Push entries"}
              </div>
              <div className="text-xs text-[#a6adc8]">
                Sync new session entries to the bundle
              </div>
            </div>
          </button>
          <button
            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#313244] hover:border-[#f38ba8]/50 hover:bg-[#f38ba8]/10 transition-colors text-left cursor-pointer disabled:opacity-50"
            onClick={handleUnlink}
            disabled={isBusy}
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-[#f38ba8]/15 text-[#f38ba8]">
              <Unlink className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-medium text-[#cdd6f4]">
                {unlinkMutation.isPending ? "Unlinking..." : "Unlink session"}
              </div>
              <div className="text-xs text-[#a6adc8]">
                Remove this connection (entries stay intact)
              </div>
            </div>
          </button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeModal}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
