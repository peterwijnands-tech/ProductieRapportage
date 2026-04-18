"""Client for fetching production data from ixgram JSON API."""

import os
import httpx
from datetime import date, timedelta
from typing import Optional

IXGRAM_URL = os.getenv(
    "IXGRAM_API_URL",
    "https://app.ixgram.com/dashboards/ajax/getWidgetSettingData/5257/6d95d03bc427960b68e32394b22f8b26244"
)

# Map SOORT_MACHINE values from ixgram API to dashboard machinegroepen
SOORT_MACHINE_MAP = {
    "druk": "Drukkerij",
    "vouw": "Vouwerij",
    "snij": "Snijderij",
    "hecht": "Vouwerij",      # hechtmachines vallen onder vouwerij
    "inpak": "Nabewerking",
    "sealen": "Nabewerking",
    "qc": "Nabewerking",
    "expeditie": "Nabewerking",
    "prepress": "Overig",
    "indirect": "Overig",
}

# Machine classification based on Excel analysis
VESTIGING_MAP = {}
MACHINEGROEP_MAP = {}

# Alkmaar machines
for code in ["15", "16", "17", "18", "19"]:
    VESTIGING_MAP[code] = "Alkmaar"
    MACHINEGROEP_MAP[code] = "Drukkerij"
for code in ["28", "29"]:
    VESTIGING_MAP[code] = "Alkmaar"
    MACHINEGROEP_MAP[code] = "Drukkerij"
for code in ["37", "40", "41"]:
    VESTIGING_MAP[code] = "Alkmaar"
    MACHINEGROEP_MAP[code] = "Snijderij"
for code in ["44"]:
    VESTIGING_MAP[code] = "Alkmaar"
    MACHINEGROEP_MAP[code] = "Vouwerij"
for code in ["47", "49", "50", "53", "54", "55", "56", "57", "58", "59",
             "60", "61", "70", "71", "72", "73", "74", "75", "76", "79",
             "80", "81", "82"]:
    VESTIGING_MAP[code] = "Alkmaar"
    MACHINEGROEP_MAP[code] = "Vouwerij"

# Uitgeest machines
for code in ["20", "22", "24", "26", "27"]:
    VESTIGING_MAP[code] = "Uitgeest"
    MACHINEGROEP_MAP[code] = "Drukkerij"
for code in ["33", "34", "35", "36"]:
    VESTIGING_MAP[code] = "Uitgeest"
    MACHINEGROEP_MAP[code] = "Drukkerij"
for code in ["39"]:
    VESTIGING_MAP[code] = "Uitgeest"
    MACHINEGROEP_MAP[code] = "Snijderij"
for code in ["46", "48", "52", "64", "65", "66", "67", "68", "69"]:
    VESTIGING_MAP[code] = "Uitgeest"
    MACHINEGROEP_MAP[code] = "Vouwerij"

# Nabewerking — toegewezen aan vestiging op basis van naam
for code in ["77", "78", "83", "84", "85", "92", "98"]:
    # Grafotronic Uitgeest, Prati Uitgeest, Prati 2 Uitgeest,
    # Inpakken Uitgeest, Krimpen sealen Uitgeest, HCA Uitgeest, Afleveren Uitgeest
    VESTIGING_MAP[code] = "Uitgeest"
    MACHINEGROEP_MAP[code] = "Nabewerking"
for code in ["86", "87", "88", "89", "90", "91", "93", "94", "95", "96", "97"]:
    # Krimpen sealen vou Alk, Krimpen sealen exp Alk, Inpakken Alkmaar EXP,
    # Inpakken Alkmaar Flexibel, Afwerking/Verpakking, Expeditie, RIO,
    # Indirect afwerking, Werk door Derden, QC, Afleveren Alkmaar
    VESTIGING_MAP[code] = "Alkmaar"
    MACHINEGROEP_MAP[code] = "Nabewerking"

# Prepress/indirect — hoofdkantoor Alkmaar
for code in ["01", "02", "03", "04", "10", "12", "13", "14", "38", "99",
             "1K", "2F", "4A", "4C", "4G", "4K", "9A", "9B", "9C", "9D", "9E", "9F"]:
    VESTIGING_MAP[code] = "Alkmaar"
    MACHINEGROEP_MAP[code] = "Overig"
for code in ["06"]:
    # Prepress Uitgeester
    VESTIGING_MAP[code] = "Uitgeest"
    MACHINEGROEP_MAP[code] = "Overig"

PLANPLAATS_NAMEN = {
    "01": "Orderinvoer", "02": "Prepress", "03": "Controle CoA Q2",
    "04": "Prepress Labels", "06": "Prepress Uitgeester",
    "10": "Montage & Kopie", "12": "Montage & Kopie Labels",
    "13": "Platen gereed", "14": "Indirect prepress",
    "15": "Komori 4 Alkmaar", "16": "Komori 5 Alkmaar",
    "17": "Komori 3 Alkmaar", "18": "Komori 1 Alkmaar",
    "19": "Komori 2 Alkmaar", "1K": "Komori Planning",
    "20": "Formprint 2 Uitgeest", "22": "Formprint 4 Uitgeest",
    "24": "Formprint 5 Uitgeest", "26": "WEB Uitgeest",
    "27": "Vision Uitgeest", "28": "Gazelle Alkmaar",
    "29": "Vision Alkmaar", "2F": "FP Planning",
    "33": "Nilpeter 2 Uitgeest", "34": "Nilpeter 5 Uitgeest",
    "35": "Nilpeter 7 Uitgeest", "36": "Nilpeter 1 Uitgeest",
    "37": "KleinSnijden Alkmaar", "38": "Indirect press",
    "39": "Snijden Uitgeest", "40": "Snijden Alkmaar",
    "41": "Snijden Alkmaar 2", "44": "MBO Alkmaar",
    "46": "HH1 Uitgeest", "47": "HH 2 Alkmaar",
    "48": "HH4 Uitgeest", "49": "GUK 1 Alkmaar",
    "50": "GUK 5 Alkmaar", "52": "HH3 Uitgeest",
    "53": "Vijuk 1 Alkmaar", "54": "Vijuk 2 Alkmaar",
    "55": "Vijuk 3 Alkmaar", "56": "HH7 Alkmaar",
    "57": "HH8 Alkmaar", "58": "Vijuk 4 Alkmaar",
    "59": "Vijuk 5 Alkmaar", "60": "Vijuk 6 Alkmaar",
    "61": "Vijuk 7 Alkmaar", "64": "GUK 1 Uitgeest",
    "65": "GUK 2 Uitgeest", "66": "GUK 3 Uitgeest",
    "67": "GUK 4 Uitgeest", "68": "GUK 5 Uitgeest",
    "69": "GUK 6 Uitgeest", "70": "GUK 7 Alkmaar",
    "71": "GUK 8 Alkmaar", "72": "Vijuk 8 Alkmaar",
    "73": "Vijuk 9 Alkmaar", "74": "Vijuk 10 Alkmaar",
    "75": "Vijuk 11 Alkmaar", "76": "Vijuk 12 Alkmaar",
    "77": "Grafotronic Uitgeest", "78": "Prati Uitgeest",
    "79": "Vijuk 13 Alkmaar", "80": "Vijuk 14 Alkmaar",
    "81": "Vijuk 15 Alkmaar", "82": "Vijuk 16 Alkmaar",
    "83": "Prati 2 Uitgeest", "84": "Inpakken Uitgeest",
    "85": "Krimpen sealen Uitgeest", "86": "Krimpen sealen vou Alk",
    "87": "Krimpen sealen exp Alk", "88": "Inpakken Alkmaar EXP",
    "89": "Inpakken Alkmaar Flexibel", "90": "Afwerking / Verpakking",
    "91": "Expeditie", "92": "HCA Uitgeest", "93": "RIO",
    "94": "Indirect afwerking", "95": "Werk door Derden",
    "96": "QC", "97": "Afleveren Alkmaar", "98": "Afleveren Uitgeest",
    "99": "Indirecte uren",
}


def get_vestiging(code: str) -> str:
    return VESTIGING_MAP.get(code, "Onbekend")


def get_machinegroep(code: str) -> str:
    return MACHINEGROEP_MAP.get(code, "Overig")


def get_planplaats_naam(code: str) -> str:
    return PLANPLAATS_NAMEN.get(code, f"Planplaats {code}")


async def fetch_productie_data(datum_van: Optional[date] = None, datum_tot: Optional[date] = None) -> list[dict]:
    """Fetch production data from ixgram API.

    The API returns JSON with structure:
    {
      "settings": { "items": [...] },   # column definitions
      "data": {
        "ploeg": [                       # array of production records
          {
            "EED_PRODUCTIE": "2026-01-02",
            "PLP": "15",
            "SOORT_MACHINE": "druk",
            "PLP_OMS": "Komori 4 Alkmaar",
            "CENTIUREN_1": "542",        # uren nachtploeg
            "CENTIUREN_2": "758",        # uren ochtendploeg
            "CENTIUREN_3": "736",        # uren middagploeg
            "AANTAL_PRODUCTIE_1": null,  # productie nachtploeg
            "AANTAL_PRODUCTIE_2": "29790",
            "AANTAL_PRODUCTIE_3": "26280",
            "WAARDE_VAST_1/2/3": ...,    # bruto omzet onafhankelijk per ploeg
            "WAARDE_PROD_1/2/3": ...,    # bruto omzet afhankelijk per ploeg
            "CENTIUREN_1/2/3_STELLEN",   # steluren per ploeg
            "CENTIUREN_1/2/3_DRAAIEN",   # draaiuren per ploeg
            "CENTIUREN_1/2_FOUTE_BEWERKING",  # stilstanduren per ploeg
            "AANTAL_RECORDS_MEMCHN_DETAIL"
          }, ...
        ]
      }
    }
    """
    if datum_van is None:
        datum_van = date.today() - timedelta(days=7)
    if datum_tot is None:
        datum_tot = date.today()

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(IXGRAM_URL)
            response.raise_for_status()
            raw_data = response.json()
    except Exception as e:
        print(f"Warning: Could not fetch ixgram data: {e}")
        return []

    # Extract the ploeg array from the nested JSON structure
    data_list = []
    if isinstance(raw_data, dict):
        data_section = raw_data.get("data", {})
        if isinstance(data_section, dict):
            data_list = data_section.get("ploeg", [])
        elif isinstance(data_section, list):
            data_list = data_section
    elif isinstance(raw_data, list):
        data_list = raw_data

    records = []
    for item in data_list:
        record = _normalize_record(item)
        if record and datum_van <= record.get("datum", date.min) <= datum_tot:
            records.append(record)

    return records


def _safe_float(val, default=0.0):
    """Safely convert a value to float, handling None and string inputs."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _normalize_record(raw: dict) -> Optional[dict]:
    """Normalize a raw ixgram record to our standard format.

    Mapped from actual ixgram JSON field names:
    - EED_PRODUCTIE -> datum
    - PLP -> planplaats_code
    - SOORT_MACHINE -> soort_machine (druk/vouw/snij/etc.)
    - PLP_OMS -> planplaats_naam
    - CENTIUREN_1/2/3 -> uren per ploeg (nacht/ochtend/middag)
    - CENTIUREN_1/2/3_STELLEN -> steluren per ploeg
    - CENTIUREN_1/2/3_DRAAIEN -> draaiuren per ploeg
    - CENTIUREN_1/2/3_FOUTE_BEWERKING -> stilstanduren per ploeg
    - AANTAL_PRODUCTIE_1/2/3 -> productie per ploeg
    - WAARDE_VAST_1/2/3 -> bruto omzet onafhankelijk per ploeg
    - WAARDE_PROD_1/2/3 -> bruto omzet afhankelijk per ploeg
    """
    try:
        code = str(raw.get("PLP", "")).strip()
        if not code:
            return None

        from datetime import datetime
        datum_raw = raw.get("EED_PRODUCTIE", "")
        if not datum_raw:
            return None

        if isinstance(datum_raw, str):
            # Expected format: "2026-01-02"
            for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%Y-%m-%dT%H:%M:%S"):
                try:
                    datum = datetime.strptime(datum_raw, fmt).date()
                    break
                except ValueError:
                    continue
            else:
                return None
        elif isinstance(datum_raw, date):
            datum = datum_raw
        else:
            return None

        # Uren per ploeg (nacht=1, ochtend=2, middag=3)
        # API levert centiuren (honderdsten van uren), delen door 100 voor echte uren
        cnt_ploeg1 = _safe_float(raw.get("CENTIUREN_1")) / 100
        cnt_ploeg2 = _safe_float(raw.get("CENTIUREN_2")) / 100
        cnt_ploeg3 = _safe_float(raw.get("CENTIUREN_3")) / 100
        cnt_totaal = cnt_ploeg1 + cnt_ploeg2 + cnt_ploeg3

        # Steluren per ploeg
        stel_1 = _safe_float(raw.get("CENTIUREN_1_STELLEN")) / 100
        stel_2 = _safe_float(raw.get("CENTIUREN_2_STELLEN")) / 100
        stel_3 = _safe_float(raw.get("CENTIUREN_3_STELLEN")) / 100
        stel_totaal = stel_1 + stel_2 + stel_3

        # Draaiuren per ploeg
        draai_1 = _safe_float(raw.get("CENTIUREN_1_DRAAIEN")) / 100
        draai_2 = _safe_float(raw.get("CENTIUREN_2_DRAAIEN")) / 100
        draai_3 = _safe_float(raw.get("CENTIUREN_3_DRAAIEN")) / 100
        draai_totaal = draai_1 + draai_2 + draai_3

        # Stilstand / foute bewerking per ploeg
        fout_1 = _safe_float(raw.get("CENTIUREN_1_FOUTE_BEWERKING")) / 100
        fout_2 = _safe_float(raw.get("CENTIUREN_2_FOUTE_BEWERKING")) / 100
        fout_3 = _safe_float(raw.get("CENTIUREN_3_FOUTE_BEWERKING")) / 100
        fout_totaal = fout_1 + fout_2 + fout_3

        # Productie per ploeg
        prod_1 = _safe_float(raw.get("AANTAL_PRODUCTIE_1"))
        prod_2 = _safe_float(raw.get("AANTAL_PRODUCTIE_2"))
        prod_3 = _safe_float(raw.get("AANTAL_PRODUCTIE_3"))
        prod_totaal = prod_1 + prod_2 + prod_3

        # Omzet: vast (onafhankelijk) + prod (afhankelijk) per ploeg
        omzet_vast_1 = _safe_float(raw.get("WAARDE_VAST_1"))
        omzet_vast_2 = _safe_float(raw.get("WAARDE_VAST_2"))
        omzet_vast_3 = _safe_float(raw.get("WAARDE_VAST_3"))
        omzet_prod_1 = _safe_float(raw.get("WAARDE_PROD_1"))
        omzet_prod_2 = _safe_float(raw.get("WAARDE_PROD_2"))
        omzet_prod_3 = _safe_float(raw.get("WAARDE_PROD_3"))
        omzet_totaal = (omzet_vast_1 + omzet_vast_2 + omzet_vast_3 +
                        omzet_prod_1 + omzet_prod_2 + omzet_prod_3)

        # Soort machine uit bron (druk/vouw/snij/etc.)
        soort_machine = str(raw.get("SOORT_MACHINE", "")).strip().lower()

        # Gebruik PLP_OMS uit API als beschikbaar, anders uit onze mapping
        plp_naam = str(raw.get("PLP_OMS", "")).strip()
        if not plp_naam:
            plp_naam = get_planplaats_naam(code)

        # Bepaal machinegroep: gebruik SOORT_MACHINE als primaire bron
        if soort_machine:
            machinegroep = SOORT_MACHINE_MAP.get(soort_machine, get_machinegroep(code))
        else:
            machinegroep = get_machinegroep(code)

        return {
            "datum": datum,
            "planplaats_code": code,
            "planplaats_naam": plp_naam,
            "vestiging": get_vestiging(code),
            "machinegroep": machinegroep,
            "soort_machine": soort_machine,
            # Uren per ploeg
            "centiuren_ploeg1": cnt_ploeg1,
            "centiuren_ploeg2": cnt_ploeg2,
            "centiuren_ploeg3": cnt_ploeg3,
            "centiuren_totaal": cnt_totaal,
            # Steluren per ploeg
            "stel_ploeg1": stel_1,
            "stel_ploeg2": stel_2,
            "stel_ploeg3": stel_3,
            "centiuren_stellen": stel_totaal,
            # Draaiuren per ploeg
            "draai_ploeg1": draai_1,
            "draai_ploeg2": draai_2,
            "draai_ploeg3": draai_3,
            "centiuren_draaien": draai_totaal,
            # Stilstand per ploeg
            "fout_ploeg1": fout_1,
            "fout_ploeg2": fout_2,
            "fout_ploeg3": fout_3,
            "centiuren_foute_bewerking": fout_totaal,
            # Productie per ploeg
            "productie_ploeg1": prod_1,
            "productie_ploeg2": prod_2,
            "productie_ploeg3": prod_3,
            "productie_totaal": prod_totaal,
            # Omzet per ploeg (vast + productieafhankelijk)
            "omzet_vast_ploeg1": omzet_vast_1,
            "omzet_vast_ploeg2": omzet_vast_2,
            "omzet_vast_ploeg3": omzet_vast_3,
            "omzet_prod_ploeg1": omzet_prod_1,
            "omzet_prod_ploeg2": omzet_prod_2,
            "omzet_prod_ploeg3": omzet_prod_3,
            "omzet": omzet_totaal,
            # Metadata
            "aantal_registraties": _safe_float(raw.get("AANTAL_RECORDS_MEMCHN_DETAIL")),
        }
    except Exception:
        return None
