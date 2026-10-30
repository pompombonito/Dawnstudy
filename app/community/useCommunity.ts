"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { communityApi } from "./api";
import type { Bootstrap, Profile, ProfileInput } from "./types";

export function useCommunity(token: string, userId?: string) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const identity = useRef(token);
  identity.current = token;
  const refresh = useCallback(async () => {
    if (!token || !userId) return;
    try {
      const result = await communityApi<Bootstrap>(token, "/bootstrap");
      if (identity.current === token) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (identity.current === token) setError((e as Error).message);
    }
  }, [token, userId]);
  useEffect(() => {
    setData(null);
    setError("");
    if (!token || !userId) return;
    setLoading(true);
    void refresh().finally(() => {
      if (identity.current === token) setLoading(false);
    });
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [token, userId, refresh]);
  useEffect(() => {
    if (!token || !data?.profile?.onboarded) return;
    const heartbeat = () => {
      if (!document.hidden)
        void communityApi(token, "/presence", {}).catch(() => {});
    };
    heartbeat();
    const timer = setInterval(heartbeat, 40000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", heartbeat);
    };
  }, [token, data?.profile?.onboarded]);
  const saveProfile = async (input: ProfileInput) => {
    const profile = await communityApi<Profile>(
      token,
      "/profile",
      input,
      "PUT",
    );
    if (identity.current === token)
      setData((old) => (old ? { ...old, profile } : null));
    return profile;
  };
  const action = async (id: string, action: string) => {
    await communityApi(token, "/friends", { user_id: id, action });
    await refresh();
  };
  return {
    data,
    error,
    loading,
    refresh,
    saveProfile,
    action,
    token,
    userId: userId || "",
  };
}
export type Community = ReturnType<typeof useCommunity>;
