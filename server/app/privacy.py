import re
from typing import List
from .schemas import UIContext

# Secondary server-side PII check patterns (regexes)
PII_PATTERNS = {
    "EMAIL": re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', re.IGNORECASE),
    "PHONE": re.compile(r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b'),
    # Basic check for unmasked CC-like numbers (min 13 digits, max 19)
    "CREDIT_CARD": re.compile(r'\b(?:\d[ -]*?){13,19}\b')
}

def luhn_check(card_num: str) -> bool:
    digits = [int(c) for c in card_num if c.isdigit()]
    if not digits:
        return False
    checksum = 0
    reverse_digits = digits[::-1]
    for i, d in enumerate(reverse_digits):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        checksum += d
    return checksum % 10 == 0

def check_for_pii(text: str, key: str = "") -> List[str]:
    found_categories = []
    if not text:
        return found_categories
        
    for category, pattern in PII_PATTERNS.items():
        if category == "PASSWORD_LIKE":
            if key not in ["sanitizedText", "label", "title", "goal"]:
                continue

        matches = pattern.findall(text)
        if matches:
            if category == "CREDIT_CARD":
                # Validate luhn for card numbers to reduce FPs
                for match in matches:
                    clean_num = ''.join(c for c in match if c.isdigit())
                    if len(clean_num) >= 13 and luhn_check(clean_num):
                        if "CREDIT_CARD" not in found_categories:
                            found_categories.append("CREDIT_CARD")
            else:
                found_categories.append(category)
                
    return found_categories

# Add a basic password heuristic: 8+ chars containing at least one letter and one digit, no spaces
PII_PATTERNS["PASSWORD_LIKE"] = re.compile(r'\b(?=\w*[A-Za-z])(?=\w*\d)[A-Za-z\d@$!%*#?&]{8,}\b')

def validate_payload_is_clean(payload: dict) -> List[str]:
    """
    Returns a list of PII categories found in the payload.
    If empty, payload is clean.
    Walks every string in the dict recursively.
    """
    leaks = set()

    def walk(obj, current_key=""):
        if isinstance(obj, str):
            found = check_for_pii(obj, current_key)
            leaks.update(found)
        elif isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, k)
        elif isinstance(obj, list):
            for v in obj:
                walk(v, current_key)

    walk(payload)
    return list(leaks)
