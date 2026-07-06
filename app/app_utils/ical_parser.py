import logging
import re

import requests

logger = logging.getLogger(__name__)

def normalize_to_local_offset(iso_str: str) -> str:
    """Converts any ISO 8601 datetime string to local offset (-04:00)."""
    try:
        import datetime
        cleaned = iso_str.replace("Z", "+00:00")
        dt = datetime.datetime.fromisoformat(cleaned)
        local_tz = datetime.timezone(datetime.timedelta(hours=-4))
        local_dt = dt.astimezone(local_tz)
        return local_dt.isoformat()
    except Exception:
        return iso_str

def parse_ical_date(val: str) -> str:
    """Converts iCal date format YYYYMMDDTHHMMSS(Z) to ISO 8601 string.
    e.g., 20260702T090000 -> 2026-07-02T09:00:00-04:00
    20260702T130000Z -> 2026-07-02T13:00:00Z
    """
    val = val.strip()
    # Simple check for YYYYMMDDTHHMMSS pattern
    if len(val) >= 15 and "T" in val:
        date_part = val[:8]
        time_part = val[9:15]
        formatted = f"{date_part[:4]}-{date_part[4:6]}-{date_part[6:8]}T{time_part[:2]}:{time_part[2:4]}:{time_part[4:6]}"
        if val.endswith("Z"):
            return normalize_to_local_offset(formatted + "Z")
        # If no explicit timezone, default to user's local offset (-04:00)
        return normalize_to_local_offset(formatted + "-04:00")
    elif len(val) == 8:
        # Date only: YYYYMMDD
        return f"{val[:4]}-{val[4:6]}-{val[6:8]}T00:00:00-04:00"
    return val

def parse_ical(content_or_url: str) -> list[dict]:
    """Fetches and parses iCal/ICS content, returning a list of dict events.
    Each event has: summary, start, end, description.
    """
    content = ""
    if content_or_url.startswith("webcal://"):
        content_or_url = content_or_url.replace("webcal://", "https://", 1)

    if content_or_url.startswith("http://") or content_or_url.startswith("https://"):
        try:
            logger.info(f"Fetching iCal feed from: {content_or_url}")
            response = requests.get(content_or_url, timeout=10)
            if response.status_code == 200:
                content = response.text
            else:
                logger.error(f"Failed to fetch iCal: HTTP {response.status_code}")
                return []
        except Exception as e:
            logger.error(f"Error fetching iCal feed: {e}")
            return []
    else:
        content = content_or_url

    events = []
    current_event = {}
    in_event = False

    # Regex for key-value parsing, handling parameter options (e.g. DTSTART;TZID=...)
    line_pattern = re.compile(r"^([^:;]+)(?:;[^:]*)?:(.*)$")

    # Unfold lines (iCal format wraps lines with a leading space/tab on next line)
    folded_lines = content.splitlines()
    unfolded_lines = []
    for line in folded_lines:
        if line.startswith(" ") or line.startswith("\t"):
            if unfolded_lines:
                unfolded_lines[-1] += line[1:]
        else:
            unfolded_lines.append(line)

    for line in unfolded_lines:
        line = line.strip()
        if not line:
            continue

        if line == "BEGIN:VEVENT":
            in_event = True
            current_event = {}
        elif line == "END:VEVENT":
            if in_event:
                # Require summary and start time
                if "summary" not in current_event:
                    current_event["summary"] = "Untitled Event"
                if "start" in current_event:
                    if "end" not in current_event:
                        current_event["end"] = current_event["start"]
                    events.append(current_event)
                in_event = False
        elif in_event:
            match = line_pattern.match(line)
            if match:
                key = match.group(1).upper()
                val = match.group(2)
                # Unescape standard iCal characters
                val = val.replace("\\,", ",").replace("\\;", ";").replace("\\N", "\n").replace("\\n", "\n")

                if key == "DTSTART":
                    current_event["start"] = parse_ical_date(val)
                elif key == "DTEND":
                    current_event["end"] = parse_ical_date(val)
                elif key == "SUMMARY":
                    current_event["summary"] = val
                elif key == "DESCRIPTION":
                    current_event["description"] = val

    logger.info(f"Parsed {len(events)} events from iCal feed.")
    return events
