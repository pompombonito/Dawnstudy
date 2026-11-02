"use client";
import { useEffect } from "react";
import { dawnstudyApiBase } from "../community/api";
import { startApiHeartbeat } from "./api-heartbeat";

export default function ApiHeartbeat() {
  useEffect(() => startApiHeartbeat(dawnstudyApiBase, {
    document, window, online: () => navigator.onLine, fetch: window.fetch.bind(window),
  }), []);
  return null;
}
