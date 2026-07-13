"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Brand } from "@/lib/types";

type Props = {
  brands: Brand[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  label?: string;
  hint?: string;
  loading?: boolean;
  id?: string;
};

type DropdownPos = { top: number; left: number; width: number; flip: boolean; maxHeight: number };

export function BrandSearchSelect({
  brands,
  selectedIndex,
  onSelect,
  label = "Select brand",
  hint,
  loading = false,
  id = "brandSearch",
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos>({ top: 0, left: 0, width: 0, flip: false, maxHeight: 280 });
  const [posReady, setPosReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = selectedIndex !== null ? brands[selectedIndex] : null;

  useEffect(() => {
    if (selected && !open) {
      setQuery(selected.name);
    }
  }, [selected, open]);

  const updatePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const flip = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(320, flip ? spaceAbove : spaceBelow));
    setPos({
      top: flip ? rect.top - 6 : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      flip,
      maxHeight,
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
  }, [open, updatePosition, query]);

  useEffect(() => {
    function onDocumentClick(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      const portal = document.getElementById(`${id}-dropdown`);
      if (portal?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [id]);

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

  function openDropdown() {
    setOpen(true);
    if (selectedIndex !== null) {
      setQuery("");
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function clearSelection() {
    onSelect(null);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }

  const dropdown =
    open && posReady && typeof document !== "undefined"
      ? createPortal(
          <div
            id={`${id}-dropdown`}
            className={`brand-search-dropdown brand-search-dropdown--portal${pos.flip ? " is-flip" : ""}`}
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              ...(pos.flip ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
          >
            {loading ? (
              <div className="brand-search-empty">Loading brands…</div>
            ) : filtered.length === 0 ? (
              <div className="brand-search-empty">No brands match your search.</div>
            ) : (
              filtered.map(({ brand, index }) => (
                <button
                  key={index}
                  type="button"
                  className="brand-search-option"
                  role="option"
                  aria-selected={selectedIndex === index}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(index);
                    setQuery(brand.name);
                    setOpen(false);
                  }}
                >
                  <span className="brand-swatch" style={{ background: brand.accent || "#4f46e5" }} />
                  <span>
                    <strong>{brand.name}</strong>
                    <small>{brand.email}</small>
                  </span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="field brand-search-field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="brand-search-meta">{hint}</p>}
      <div
        className={`brand-combobox${open ? " is-open" : ""}`}
        ref={wrapRef}
      >
        <input
          ref={inputRef}
          id={id}
          type="search"
          className="brand-combobox-input"
          placeholder={loading ? "Loading brands…" : "Search brands…"}
          autoComplete="off"
          aria-expanded={open}
          aria-controls={`${id}-dropdown`}
          aria-autocomplete="list"
          disabled={loading}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (selectedIndex !== null) onSelect(null);
            setOpen(true);
          }}
          onFocus={openDropdown}
          onClick={openDropdown}
        />
      </div>
      {selected && !open && (
        <div className="brand-selected-pill">
          <span className="brand-swatch" style={{ background: selected.accent || "#4f46e5" }} />
          <span>{selected.name}</span>
          {selected.email && <small className="brand-pill-email">{selected.email}</small>}
          <button type="button" className="brand-clear-btn" onClick={clearSelection} title="Clear selection">
            ×
          </button>
        </div>
      )}
      {dropdown}
    </div>
  );
}
