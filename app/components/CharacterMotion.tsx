"use client";

import { useEffect } from "react";

/** One observer for the roster; native CSS animates without a render loop. */
export default function CharacterMotion() {
  useEffect(() => {
    const updateVisibility = () => {
      document.documentElement.dataset.motionPaused = String(document.hidden);
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);

    const intersection = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      for (const entry of entries) {
        (entry.target as SVGElement).dataset.motionVisible = String(entry.isIntersecting);
      }
    });
    const visit = (node: Node, register: boolean) => {
      if (!(node instanceof Element)) return;
      const avatars = [...(node.matches(".motion-avatar") ? [node] : []), ...node.querySelectorAll(".motion-avatar")];
      for (const avatar of avatars) {
        if (register) intersection?.observe(avatar);
        else intersection?.unobserve(avatar);
      }
    };
    visit(document.body, true);
    const mutations = new MutationObserver(records => {
      // Unregister removals first so moving an avatar leaves it registered.
      for (const record of records) for (const node of record.removedNodes) visit(node, false);
      for (const record of records) for (const node of record.addedNodes) visit(node, true);
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      intersection?.disconnect();
      mutations.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
      delete document.documentElement.dataset.motionPaused;
    };
  }, []);
  return null;
}
