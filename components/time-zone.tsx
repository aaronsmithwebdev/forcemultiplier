"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { formatDate } from "@/lib/time-zone";

const TimeZoneContext = createContext<{
  timeZone: string;
  setTimeZone: (value: string) => void;
} | null>(null);

export function TimeZoneProvider({
  children,
  initialTimeZone,
}: {
  children: ReactNode;
  initialTimeZone: string;
}) {
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  return (
    <TimeZoneContext.Provider value={{ timeZone, setTimeZone }}>
      {children}
    </TimeZoneContext.Provider>
  );
}

export function useTimeZone() {
  const value = useContext(TimeZoneContext);
  if (!value) throw new Error("Time zone provider is missing.");
  return value;
}

export function useDate() {
  const { timeZone } = useTimeZone();
  return (value: string | Date | null | undefined) =>
    formatDate(value, timeZone);
}
