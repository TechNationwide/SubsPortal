"""Seed data for a fresh installation."""

DEFAULT_BRANDS = [
    {
        "name": "Nationwide",
        "email": "deals@nationwideadvance.com",
        "app": "Nationwide Application",
        "accent": "#4f46e5",
        "aquamark_email": "",
    },
    {
        "name": "Ontrack",
        "email": "submissions@ontrackfunding.com",
        "app": "Ontrack Application",
        "accent": "#059669",
        "aquamark_email": "",
    },
    {
        "name": "Funding Tech",
        "email": "submissions@fundingtech.com",
        "app": "Funding Tech Application",
        "accent": "#7c3aed",
        "aquamark_email": "",
    },
    {
        "name": "Zsales",
        "email": "submissions@zsalesfunding.com",
        "app": "Zsales Application",
        "accent": "#ea580c",
        "aquamark_email": "",
    },
    {
        "name": "AJ Nationwide",
        "email": "deals@ajnationwideconsulting.com",
        "app": "AJ Nationwide Application",
        "accent": "#0284c7",
        "aquamark_email": "",
    },
]

DEFAULT_FUNDERS = [
    {"name": "Forward Funding Capital", "email": "submissions@forwardfunding.com", "brands": [0, 1, 2]},
    {"name": "Rapid Merchant Group", "email": "deals@rapidmerchant.com", "brands": [0, 1, 3]},
    {"name": "BlueLine Capital", "email": "underwriting@bluelinecapital.com", "brands": [0, 2, 4]},
    {"name": "Evergreen MCA", "email": "deals@evergreenmca.com", "brands": [1, 2, 3]},
    {"name": "Summit Advance", "email": "submissions@summitadvance.com", "brands": [0, 1, 2, 3, 4]},
    {"name": "NorthBridge Funding", "email": "deals@northbridgefunding.com", "brands": [2, 3, 4]},
]

DEFAULT_TEAMS = [
    {
        "id": "max-team",
        "name": "Max's Team",
        "lead": "Max Morris",
        "members": [
            {"name": "Max Morris", "email": "max@company.com"},
            {"name": "Morris", "email": "morris@company.com"},
            {"name": "Abe", "email": "abe@company.com"},
            {"name": "Kevin", "email": "kevin@company.com"},
        ],
    },
    {
        "id": "sarah-team",
        "name": "Sarah's Team",
        "lead": "Sarah Chen",
        "members": [
            {"name": "Sarah Chen", "email": "sarah@company.com"},
            {"name": "James", "email": "james@company.com"},
            {"name": "Lisa", "email": "lisa@company.com"},
        ],
    },
    {
        "id": "david-team",
        "name": "David's Team",
        "lead": "David Park",
        "members": [
            {"name": "David Park", "email": "david@company.com"},
            {"name": "Rachel", "email": "rachel@company.com"},
            {"name": "Tom", "email": "tom@company.com"},
            {"name": "Nina", "email": "nina@company.com"},
        ],
    },
]
