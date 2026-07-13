"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Brand } from "@/lib/types";

type Props = {
  brands: Brand[];
  selected: number[];
  onChange: (indices: number[]) => void;
};

type DropdownPos = { top: number; left: number; width: number; flip: boolean };

export function BrandMultiSelect({ brands, selected, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos>({ top: 0, left: 0, width: 0, flip: false });
  const [posReady, setPosReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = brands
    .map((brand, index) => ({ brand, index }))
    .filter(({ brand }) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        brand.name.toLowerCase().includes(q) ||
        (brand.email || "").toLowerCase().includes(q)
      );
    });

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
      const portal = document.getElementById("funderBrandDropdown");
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
            id="funderBrandDropdown"
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
              <div className="brand-search-empty">No brands match your search.</div>
            ) : (
              filtered.map(({ brand, index }) => {
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
                    <span className="brand-swatch" style={{ background: brand.accent || "#4f46e5" }} />
                    <span className="crm-multiselect-option-text">
                      <strong>{brand.name}</strong>
                      <small>{brand.email || ""}</small>
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
    <div className={`crm-multiselect${open ? " is-open" : ""}`} ref={wrapRef}>
      <div className="crm-multiselect-chips">
        {!selected.length ? (
          <span className="crm-multiselect-empty">No brands selected — search below to add.</span>
        ) : (
          selected.map((bi) => {
            const brand = brands[bi];
            if (!brand) return null;
            return (
              <span
                key={bi}
                className="crm-tag crm-tag-removable"
                style={{ ["--tag-color" as string]: brand.accent || "#4f46e5" }}
              >
                {brand.name}
                <button type="button" onClick={() => toggle(bi)} aria-label={`Remove ${brand.name}`}>
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
        placeholder="Search brands to add…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={openDropdown}
        onClick={openDropdown}
        aria-expanded={open}
        aria-controls="funderBrandDropdown"
        autoComplete="off"
      />
      {dropdown}
    </div>
  );
}
