import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDeleteBundle } from "@/hooks/mutations/useDeleteBundle";
import { useUIStore } from "@/stores/uiStore";

export function DeleteBundleDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const target = useUIStore((s) => s.deleteBundleTarget);
  const closePanel = useUIStore((s) => s.closePanel);
  const selectedBundleId = useUIStore((s) => s.selectedBundleId);
  const open = activeModal === "delete-bundle" && !!target;
  const mutation = useDeleteBundle();

  const handleDelete = () => {
    if (!target) return;
    mutation.mutate(
      { id: target.id, mode: target.mode },
      {
        onSuccess: () => {
          if (selectedBundleId === target.id) closePanel();
          closeModal();
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Bundle</DialogTitle>
          <DialogDescription>
            This will permanently delete <strong>"{target?.name}"</strong> and
            all its entries. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
