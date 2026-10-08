"use client";

import { useEffect, useState } from "react";
import { FLOW_STEPS } from "@/lib/architecture-docs";

type Props = {
  mode: "static" | "animated";
};

export function ArchitectureFlow({ mode }: Props) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(mode === "animated");

  useEffect(() => {
    setPlaying(mode === "animated");
    setActive(0);
  }, [mode]);

  useEffect(() => {
    if (mode !== "animated" || !playing) return;
    const id = window.setInterval(() => {
      setActive((prev) => (prev + 1) % FLOW_STEPS.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [mode, playing]);

  return (
    <div className="arch-flow" aria-label="Deal flow diagram">
      <div className="arch-flow-track">
        {FLOW_STEPS.map((step, index) => {
          const isActive = mode === "animated" && index === active;
          const isPast = mode === "animated" && index < active;
          return (
            <div key={step.id} className="arch-flow-item-wrap">
              <button
                type="button"
                className={`arch-flow-node${isActive ? " is-active" : ""}${isPast ? " is-past" : ""}${mode === "static" ? " is-static" : ""}`}
                onClick={() => {
                  setActive(index);
                  setPlaying(false);
                }}
              >
                <span className="arch-flow-num">{index + 1}</span>
                <span className="arch-flow-label">{step.title.replace(/^\d+\.\s*/, "")}</span>
              </button>
              {index < FLOW_STEPS.length - 1 && (
                <span className={`arch-flow-arrow${isPast || mode === "static" ? " is-on" : ""}`} aria-hidden>
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="arch-flow-detail card panel">
        <div className="arch-flow-detail-head">
          <h3>{FLOW_STEPS[active].title}</h3>
          {mode === "animated" && (
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? "Pause" : "Play"}
            </button>
          )}
        </div>
        <p>{FLOW_STEPS[active].text}</p>
      </div>
    </div>
  );
}
