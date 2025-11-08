"use client";

import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import { clsx } from "clsx";

export type ToastOptions = {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
};

type Toast = ToastOptions & { id: number };

type ToastContextValue = {
  toasts: Toast[];
  toast: (options: ToastOptions) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      toast: (options) => {
        setToasts((current) => [...current, { ...options, id: Date.now() }]);
      },
      dismiss: (id) => setToasts((current) => current.filter((toast) => toast.id !== id))
    }),
    [toasts]
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return context;
}

export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center space-y-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            "pointer-events-auto w-full max-w-sm rounded-lg border px-4 py-3 shadow-lg",
            toast.variant === "destructive"
              ? "border-red-500/30 bg-red-500/20 text-red-100"
              : "border-slate-700 bg-slate-900/90 text-slate-100"
          )}
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold">{toast.title}</p>
              {toast.description ? <p className="text-xs text-slate-300">{toast.description}</p> : null}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="ml-2 text-xs text-slate-400 hover:text-slate-200"
            >
              Close
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
