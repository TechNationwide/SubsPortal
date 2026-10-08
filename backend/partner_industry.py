"""Shared Industry / NAICS checks for partner funder payloads.

Keith's EDWINS TREE AND GARDEN deal (2026-09-04) failed OnDeck + CAN because
`industry_naics_code` was the billing state (`va` / `VA`), not an industry.
Empty industry is fine (CAN defaults to "Other"; OnDeck accepts blank).
"""

from __future__ import annotations

import re

# USPS state + DC abbreviations — reject when someone pastes state into Industry.
_US_STATE_CODES = frozenset(
    {
        "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
        "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
        "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
        "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
        "WV", "WI", "WY",
    }
)


def _raw(value: object) -> str:
    return str(value or "").strip()


def looks_like_us_state_code(value: object) -> bool:
    v = _raw(value)
    return len(v) == 2 and v.isalpha() and v.upper() in _US_STATE_CODES


def validate_industry_for_ondeck(value: object) -> None:
    """Raise ValueError before any OnDeck network call if Industry is unusable."""
    v = _raw(value)
    if not v:
        return
    if looks_like_us_state_code(v):
        raise ValueError(
            f'OnDeck — Industry / NAICS: looks like a US state code ("{v}"), not an industry. '
            "Enter a 2–6 digit NAICS code (e.g. 561730) or leave blank."
        )
    digits = re.sub(r"\D", "", v)
    if not (2 <= len(digits) <= 6):
        raise ValueError(
            f'OnDeck — Industry / NAICS: must be a 2–6 digit NAICS code (got "{v}"). '
            "Leave blank if you do not have one."
        )


def validate_industry_for_can(value: object) -> None:
    """Raise ValueError before any CAN network call if Industry is a state code."""
    v = _raw(value)
    if not v:
        return
    if looks_like_us_state_code(v):
        raise ValueError(
            f'Industry looks like a US state code ("{v}"), not an industry name or NAICS. '
            'Enter a real industry (or leave blank — CAN will use "Other").'
        )


def can_industry_value(value: object) -> str:
    """Map form industry to CAN's accountDetails.industry (blank → Other)."""
    validate_industry_for_can(value)
    return _raw(value) or "Other"
