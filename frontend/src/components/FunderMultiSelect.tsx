"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Funder } from "@/lib/types";

type Props = {
  funders: Funder[];
  selected: number[];
  onChange: (indices: number[]) => void;
  hint?: string;
  /** When set, only these funder indices appear in the dropdown. */
  availableIndices?: number[];
};

type DropdownPos = { top: number; left: number; width: number; flip: boolean };

export function FunderMultiSelect({ funders, selected, onChange, hint, availableIndices }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos>({ top: 0, left: 0, width: 0, flip: false });
  const [posReady, setPosReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = (availableIndices ?? funders.map((_, index) => index))
    .map((index) => ({ funder: funders[index], index }))
    .filter(({ funder }) => Boolean(funder));

  const filtered = options.filter(({ funder }) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        funder.name.toLowerCase().includes(q) ||
        (funder.email || "").toLowerCase().includes(q)
      );
    });

  const emptyMessage =
    availableIndices !== undefined && !availableIndices.length
      ? "No funders apply to this brand. Assign brands on the Funders page."
      : "No funders match your search.";

  const updatePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flip = spaceBelow < 220 && rect.top > spaceBelow;
    setPos({
      top: flip ? rect.top - 6 : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      flip,
    });
    setPosReady(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosReady(false);
      return;
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition, query, selected]);

  useEffect(() => {
    function onDocumentClick(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      const portal = document.getElementById("submitFunderDropdown");
      if (portal?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  function openDropdown() {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function toggle(index: number) {
    if (selected.includes(index)) {
      onChange(selected.filter((i) => i !== index));
    } else {
      onChange([...selected, index].sort((a, b) => a - b));
    }
  }

  const dropdown =
    open && posReady && typeof document !== "undefined"
      ? createPortal(
          <div
            id="submitFunderDropdown"
            className={`crm-multiselect-dropdown crm-multiselect-dropdown--portal${pos.flip ? " is-flip" : ""}`}
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              ...(pos.flip ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
          >
            {!filtered.length ? (
              <div className="brand-search-empty">{emptyMessage}</div>
            ) : (
              filtered.map(({ funder, index }) => {
                const isSelected = selected.includes(index);
                return (
                  <button
                    key={index}
                    type="button"
                    className={`crm-multiselect-option${isSelected ? " selected" : ""}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(index)}
                  >
                    <span className="funder-select-dot" aria-hidden />
                    <span className="crm-multiselect-option-text">
                      <strong>{funder.name}</strong>
                      <small>{funder.email || "No email configured"}</small>
                    </span>
                    <span className="crm-multiselect-check">{isSelected ? "✓" : ""}</span>
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="field funder-multiselect-field">
      <label>Funder recipients *</label>
      {hint && <p className="brand-search-meta">{hint}</p>}
      <div className={`crm-multiselect${open ? " is-open" : ""}`} ref={wrapRef}>
        <div className="crm-multiselect-chips">
          {!selected.length ? (
            <span className="crm-multiselect-empty">No funders selected — pick from the list below.</span>
          ) : (
            selected.map((fi) => {
              const funder = funders[fi];
              if (!funder) return null;
              return (
                <span key={fi} className="crm-tag crm-tag-removable funder-tag">
                  {funder.name}
                  <button type="button" onClick={() => toggle(fi)} aria-label={`Remove ${funder.name}`}>
                    ×
                  </button>
                </span>
              );
            })
          )}
        </div>
        <input
          ref={inputRef}
          type="search"
          className="crm-multiselect-input"
          placeholder="Search funders for this brand…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={openDropdown}
          onClick={openDropdown}
          aria-expanded={open}
          aria-controls="submitFunderDropdown"
          autoComplete="off"
        />
        {dropdown}
      </div>
    </div>
  );
}
