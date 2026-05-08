"use client";

import { useEffect, useRef } from "react";
import { useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";

/// Subscribes to a wagmi transaction hash and emits a toast lifecycle:
/// pending - success/error. Calls `onSuccess` once the receipt is mined.
export function useTxToast({
  hash,
  pendingMsg = "Transaction pending…",
  successMsg = "Confirmed",
  onSuccess,
}: {
  hash?: `0x${string}`;
  pendingMsg?: string;
  successMsg?: string;
  onSuccess?: () => void;
}) {
  const { isLoading, isSuccess, isError, error } =
    useWaitForTransactionReceipt({ hash });

  // Track which tx hash we've already toasted for, so re-renders don't spam.
  const reportedHash = useRef<string | null>(null);
  const pendingId = useRef<string | number | null>(null);

  useEffect(() => {
    if (!hash) return;
    if (reportedHash.current === hash) return;

    if (isLoading && pendingId.current === null) {
      pendingId.current = toast.loading(pendingMsg, {
        description: hash.slice(0, 10) + "…",
      });
      return;
    }

    if (isSuccess) {
      if (pendingId.current !== null) toast.dismiss(pendingId.current);
      toast.success(successMsg);
      reportedHash.current = hash;
      pendingId.current = null;
      onSuccess?.();
    } else if (isError) {
      if (pendingId.current !== null) toast.dismiss(pendingId.current);
      toast.error("Transaction failed", {
        description: (error as Error | undefined)?.message?.slice(0, 120),
      });
      reportedHash.current = hash;
      pendingId.current = null;
    }
  }, [hash, isLoading, isSuccess, isError, error, pendingMsg, successMsg, onSuccess]);

  return { isLoading, isSuccess, isError };
}
