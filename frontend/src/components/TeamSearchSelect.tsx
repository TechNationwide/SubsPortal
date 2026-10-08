"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Team } from "@/lib/types";

type Props = {
  teams: Team[];
  selectedId: string;
  onSelect: (id: string) => void;
  label?: string;
  hint?: string;
  loading?: boolean;
  id?: string;
};

type DropdownPos = { top: number; left: number; width: number; flip: boolean; maxHeight: number };

export function TeamSearchSelect({
  teams,
  selectedId,
  onSelect,
  label = "Team (CC on emails, optional)",
  hint,
  loading = false,
  id = "teamSearch",
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos>({ top: 0, left: 0, width: 0, flip: false, maxHeight: 280 });
  const [posReady, setPosReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = selectedId ? teams.find((t) => t.id === selectedId) ?? null : null;

  useEffect(() => {
    if (selected && !open) {
      setQuery(selected.name);
    }
    if (!selected && !open) {
      setQuery("");
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

  const filtered = teams.filter((team) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (team.name.toLowerCase().includes(q)) return true;
    if ((team.lead || "").toLowerCase().includes(q)) return true;
    return team.members.some(
      (m) =>
        (m.name || "").toLowerCase().includes(q) ||
        (m.email || "").toLowerCase().includes(q),
    );
  });

  function openDropdown() {
    setOpen(true);
    if (selectedId) {
      setQuery("");
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function clearSelection() {
    onSelect("");
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
            <button
              type="button"
              className="brand-search-option"
              role="option"
              aria-selected={!selectedId}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect("");
                setQuery("");
                setOpen(false);
              }}
            >
              <span>
                <strong>No team — skip CC</strong>
                <small>Do not auto-fill team CC on emails</small>
              </span>
            </button>
            {loading ? (
              <div className="brand-search-empty">Loading teams…</div>
            ) : filtered.length === 0 ? (
              <div className="brand-search-empty">No teams match your search.</div>
            ) : (
              filtered.map((team) => {
                const ccCount = team.members.filter((m) => m.email.trim()).length;
                return (
                  <button
                    key={team.id}
                    type="button"
                    className="brand-search-option"
                    role="option"
                    aria-selected={selectedId === team.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onSelect(team.id);
                      setQuery(team.name);
                      setOpen(false);
                    }}
                  >
                    <span>
                      <strong>{team.name}</strong>
                      <small>
                        {team.lead ? `Lead: ${team.lead}` : "No lead set"}
                        {ccCount ? ` · ${ccCount} CC email${ccCount === 1 ? "" : "s"}` : " · no CC emails"}
                      </small>
                    </span>
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="field brand-search-field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="brand-search-meta">{hint}</p>}
      <div className={`brand-combobox${open ? " is-open" : ""}`} ref={wrapRef}>
        <input
          ref={inputRef}
          id={id}
          type="search"
          className="brand-combobox-input"
          placeholder={loading ? "Loading teams…" : "Search teams…"}
          autoComplete="off"
          aria-expanded={open}
          aria-controls={`${id}-dropdown`}
          aria-autocomplete="list"
          disabled={loading}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (selectedId) onSelect("");
            setOpen(true);
          }}
          onFocus={openDropdown}
          onClick={openDropdown}
        />
      </div>
      {selected && !open && (
        <div className="brand-selected-pill">
          <span>{selected.name}</span>
          {selected.lead ? <small className="brand-pill-email">{selected.lead}</small> : null}
          <button type="button" className="brand-clear-btn" onClick={clearSelection} title="Clear selection">
            ×
          </button>
        </div>
      )}
      {dropdown}
    </div>
  );
}
