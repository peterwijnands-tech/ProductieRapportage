"""Main FastAPI application for Productie Dashboard."""

import os
from datetime import date, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.app.database import get_db, init_db
from backend.app.models import Norm, Setting, GrafiekConfig
from backend.app.ixgram_client import (
    fetch_productie_data, get_vestiging, get_machinegroep,
    get_planplaats_naam, PLANPLAATS_NAMEN
)

app = FastAPI(title="Productie Dashboard", version="1.0.0")

# Mount static files
app.mount("/static", StaticFiles(directory="frontend/static"), name="static")


@app.on_event("startup")
def startup():
    init_db()


# ── Pydantic schemas ──────────────────────────────────────────────

class NormCreate(BaseModel):
    planplaats_code: str
    planplaats_naam: Optional[str] = None
    vestiging: Optional[str] = None
    machinegroep: Optional[str] = None
    norm_omzet_per_dienst: Optional[float] = None
    norm_snelheid: Optional[float] = None
    norm_stelpercentage: Optional[float] = None
    norm_bezetting: Optional[float] = None
    geldig_vanaf: date


class NormResponse(NormCreate):
    id: int
    class Config:
        from_attributes = True


class SettingUpdate(BaseModel):
    value: str


# ── Pages ─────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse("frontend/templates/index.html")


# ── API: Auth ────────────────────────────────────────────────────

class AuthRequest(BaseModel):
    wachtwoord: str

@app.post("/api/auth/verify")
def verify_beheer_password(req: AuthRequest):
    correct = os.getenv("BEHEER_WACHTWOORD", "")
    if not correct:
        return {"ok": True}
    if req.wachtwoord == correct:
        return {"ok": True}
    raise HTTPException(status_code=401, detail="Onjuist wachtwoord")


# ── API: Debug raw data ──────────────────────────────────────────

@app.get("/api/debug/raw")
async def debug_raw(
    van: Optional[date] = Query(None),
    tot: Optional[date] = Query(None),
    planplaats: Optional[str] = Query(None),
):
    """Debug endpoint: toont ruwe genormaliseerde records per machine/dag."""
    if van is None:
        van = date.today() - timedelta(days=1)
    if tot is None:
        tot = date.today()
    data = await fetch_productie_data(van, tot)
    if planplaats:
        data = [r for r in data if r["planplaats_code"] == planplaats]
    # Convert dates to strings
    for r in data:
        if "datum" in r and hasattr(r["datum"], "isoformat"):
            r["datum"] = r["datum"].isoformat()
    return {"count": len(data), "records": data}


@app.get("/api/debug/onbekend")
async def debug_onbekend(
    van: Optional[date] = Query(None), tot: Optional[date] = Query(None)
):
    """Toon planplaatsen die niet als Alkmaar of Uitgeest worden herkend."""
    data = await fetch_productie_data(van, tot)
    onbekend = {}
    for r in data:
        if r["vestiging"] not in ("Alkmaar", "Uitgeest"):
            code = r["planplaats_code"]
            if code not in onbekend:
                onbekend[code] = {"code": code, "naam": r.get("planplaats_naam", "?"),
                                  "vestiging": r["vestiging"], "omzet": 0, "records": 0}
            onbekend[code]["omzet"] += r.get("omzet", 0)
            onbekend[code]["records"] += 1
    return {"totaal_omzet_onbekend": round(sum(v["omzet"] for v in onbekend.values()), 2),
            "planplaatsen": list(onbekend.values())}

@app.get("/api/debug/api-raw")
async def debug_api_raw(planplaats: Optional[str] = Query(None)):
    """Debug endpoint: toont ongefilterde ruwe API-rijen voor een planplaats."""
    import httpx
    url = os.environ.get("IXGRAM_API_URL", "")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        raw_data = response.json()
    data_list = raw_data.get("data", {}).get("ploeg", [])
    if planplaats:
        data_list = [r for r in data_list if str(r.get("PLP", "")).strip() == planplaats]
    return {"count": len(data_list), "rows": data_list}


# ── API: Production data ──────────────────────────────────────────

@app.get("/api/productie")
async def get_productie(
    van: Optional[date] = Query(None, description="Start datum (YYYY-MM-DD)"),
    tot: Optional[date] = Query(None, description="Eind datum (YYYY-MM-DD)"),
    vestiging: Optional[str] = Query(None, description="Alkmaar, Uitgeest of beide"),
    machinegroep: Optional[str] = Query(None),
    planplaats: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if van is None:
        settings = {s.key: s.value for s in db.query(Setting).all()}
        dagen = int(settings.get("standaard_periode_dagen", "7"))
        van = date.today() - timedelta(days=dagen)
    if tot is None:
        tot = date.today()

    data = await fetch_productie_data(van, tot)

    # Apply filters
    if vestiging and vestiging.lower() != "beide":
        data = [r for r in data if r["vestiging"].lower() == vestiging.lower()]
    if machinegroep:
        data = [r for r in data if r["machinegroep"].lower() == machinegroep.lower()]
    if planplaats:
        data = [r for r in data if r["planplaats_code"] == planplaats]

    # Enrich with norms
    normen = {}
    for norm in db.query(Norm).all():
        normen[norm.planplaats_code] = {
            "norm_omzet_per_dienst": norm.norm_omzet_per_dienst,
            "norm_snelheid": norm.norm_snelheid,
            "norm_stelpercentage": norm.norm_stelpercentage,
            "norm_bezetting": norm.norm_bezetting,
        }

    for record in data:
        code = record["planplaats_code"]
        norm = normen.get(code, {})
        record["norm_omzet_per_dienst"] = norm.get("norm_omzet_per_dienst")
        record["norm_snelheid"] = norm.get("norm_snelheid")

        # Calculated fields
        draai = record.get("centiuren_draaien", 0)
        totaal = record.get("centiuren_totaal", 0)
        stel = record.get("centiuren_stellen", 0)
        prod = record.get("productie_totaal", 0)

        record["gem_snelheid"] = round(prod / draai, 1) if draai > 0 else 0
        record["stelpercentage"] = round((stel / totaal) * 100, 1) if totaal > 0 else 0
        record["foutpercentage"] = round(
            (record.get("centiuren_foute_bewerking", 0) / totaal) * 100, 1
        ) if totaal > 0 else 0

        # Norm deviation
        if norm.get("norm_snelheid") and record["gem_snelheid"] > 0:
            record["norm_afwijking_snelheid"] = round(
                ((record["gem_snelheid"] - norm["norm_snelheid"]) / norm["norm_snelheid"]) * 100, 1
            )
        else:
            record["norm_afwijking_snelheid"] = None

    # Convert dates to strings for JSON
    for r in data:
        if isinstance(r.get("datum"), date):
            r["datum"] = r["datum"].isoformat()

    return {"data": data, "periode": {"van": van.isoformat(), "tot": tot.isoformat()}}


@app.get("/api/overzicht")
async def get_overzicht(
    van: Optional[date] = Query(None),
    tot: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """Management overview: aggregated KPIs."""
    if van is None:
        settings = {s.key: s.value for s in db.query(Setting).all()}
        dagen = int(settings.get("standaard_periode_dagen", "7"))
        van = date.today() - timedelta(days=dagen)
    if tot is None:
        tot = date.today()

    data = await fetch_productie_data(van, tot)
    settings = {s.key: s.value for s in db.query(Setting).all()}

    # Aggregate per vestiging
    totaal_omzet = sum(r.get("omzet", 0) for r in data)
    omzet_alkmaar = sum(r.get("omzet", 0) for r in data if r["vestiging"] == "Alkmaar")
    omzet_uitgeest = sum(r.get("omzet", 0) for r in data if r["vestiging"] == "Uitgeest")
    # Log onbekende vestigingen
    onbekend = [r for r in data if r["vestiging"] not in ("Alkmaar", "Uitgeest")]
    if onbekend:
        codes = set((r["planplaats_code"], r.get("planplaats_naam", "?"), r["vestiging"]) for r in onbekend)
        import logging; logging.warning(f"Onbekende vestiging records: {codes}")

    # Aggregate per dag for chart
    omzet_per_dag = {}
    for r in data:
        dag = r["datum"] if isinstance(r["datum"], str) else r["datum"].isoformat()
        if dag not in omzet_per_dag:
            omzet_per_dag[dag] = {"alkmaar": 0, "uitgeest": 0}
        if r["vestiging"] == "Alkmaar":
            omzet_per_dag[dag]["alkmaar"] += r.get("omzet", 0)
        elif r["vestiging"] == "Uitgeest":
            omzet_per_dag[dag]["uitgeest"] += r.get("omzet", 0)

    # Historisch gemiddelde per weekdag: haal ALLE data op (brede datumrange)
    # en bereken gemiddelde omzet per weekdag (0=ma..6=zo) over alle weken met waarde > 0
    all_data = await fetch_productie_data(date(2026, 1, 1), date(2027, 1, 1))
    weekdag_totalen: dict[int, list[float]] = {}
    dag_omzet_all: dict[str, float] = {}
    for r in all_data:
        dag = r["datum"] if isinstance(r["datum"], str) else r["datum"].isoformat()
        dag_omzet_all[dag] = dag_omzet_all.get(dag, 0) + r.get("omzet", 0)

    for dag_str, omzet_totaal in dag_omzet_all.items():
        if omzet_totaal <= 0:
            continue  # skip feestdagen/lege dagen
        try:
            dt = date.fromisoformat(dag_str)
        except ValueError:
            continue
        wd = dt.weekday()  # 0=maandag
        if wd not in weekdag_totalen:
            weekdag_totalen[wd] = []
        weekdag_totalen[wd].append(omzet_totaal)

    weekdag_gemiddelde: dict[int, float] = {}
    for wd, waarden in weekdag_totalen.items():
        weekdag_gemiddelde[wd] = round(sum(waarden) / len(waarden), 2) if waarden else 0

    import logging
    logging.info(f"Weekdag gemiddelden berekend: {weekdag_gemiddelde} (op basis van {len(dag_omzet_all)} dagen)")

    # Per dag in de geselecteerde periode: gemiddelde en afwijking toevoegen
    for dag_str, dag_data in omzet_per_dag.items():
        try:
            dt = date.fromisoformat(dag_str)
        except ValueError:
            continue
        wd = dt.weekday()
        gem = weekdag_gemiddelde.get(wd, 0)
        dag_totaal = dag_data["alkmaar"] + dag_data["uitgeest"]
        afwijking = round(((dag_totaal - gem) / gem) * 100, 1) if gem > 0 else 0
        dag_data["gemiddelde"] = gem
        dag_data["afwijking_pct"] = afwijking

    # Signals: machines significantly below or above norm
    drempel_rood = float(settings.get("drempel_norm_rood", "20"))
    drempel_oranje = float(settings.get("drempel_norm_oranje", "10"))
    drempel_max_boven = float(settings.get("drempel_norm_max_boven", "100"))
    normen = {n.planplaats_code: n for n in db.query(Norm).all()}

    signalen = []
    # Aggregate per machine over period
    machine_totals = {}
    for r in data:
        code = r["planplaats_code"]
        if code not in machine_totals:
            machine_totals[code] = {
                "planplaats_code": code,
                "planplaats_naam": r["planplaats_naam"],
                "vestiging": r["vestiging"],
                "machinegroep": r["machinegroep"],
                "productie_totaal": 0,
                "centiuren_draaien": 0,
            }
        machine_totals[code]["productie_totaal"] += r.get("productie_totaal", 0)
        machine_totals[code]["centiuren_draaien"] += r.get("centiuren_draaien", 0)

    for code, mt in machine_totals.items():
        if code in normen and normen[code].norm_snelheid:
            draai = mt["centiuren_draaien"]
            if draai > 0:
                gem_snelheid = mt["productie_totaal"] / draai
                norm_snelheid = normen[code].norm_snelheid
                afwijking = ((gem_snelheid - norm_snelheid) / norm_snelheid) * 100
                if afwijking < -drempel_rood:
                    signalen.append({
                        "type": "kritiek",
                        "machine": mt["planplaats_naam"],
                        "code": code,
                        "vestiging": mt["vestiging"],
                        "afwijking": round(afwijking, 1),
                        "tekst": f"{mt['planplaats_naam']} presteert {abs(round(afwijking, 1))}% onder norm"
                    })
                elif afwijking < -drempel_oranje:
                    signalen.append({
                        "type": "waarschuwing",
                        "machine": mt["planplaats_naam"],
                        "code": code,
                        "vestiging": mt["vestiging"],
                        "afwijking": round(afwijking, 1),
                        "tekst": f"{mt['planplaats_naam']} presteert {abs(round(afwijking, 1))}% onder norm"
                    })
                if afwijking > drempel_max_boven:
                    signalen.append({
                        "type": "kritiek",
                        "machine": mt["planplaats_naam"],
                        "code": code,
                        "vestiging": mt["vestiging"],
                        "afwijking": round(afwijking, 1),
                        "tekst": f"{mt['planplaats_naam']} +{round(afwijking, 1)}% boven norm (mogelijk foutieve data)"
                    })

    signalen.sort(key=lambda s: s["afwijking"])

    return {
        "periode": {"van": van.isoformat(), "tot": tot.isoformat()},
        "kpi": {
            "totaal_omzet": round(totaal_omzet, 2),
            "omzet_alkmaar": round(omzet_alkmaar, 2),
            "omzet_uitgeest": round(omzet_uitgeest, 2),
        },
        "omzet_per_dag": dict(sorted(omzet_per_dag.items())),
        "signalen": signalen[:10],
    }


# ── API: Norms CRUD ──────────────────────────────────────────────

@app.get("/api/normen", response_model=list[NormResponse])
def list_normen(db: Session = Depends(get_db)):
    return db.query(Norm).order_by(Norm.planplaats_code).all()


@app.post("/api/normen", response_model=NormResponse)
def create_norm(norm: NormCreate, db: Session = Depends(get_db)):
    # Auto-fill vestiging and machinegroep
    if not norm.vestiging:
        norm.vestiging = get_vestiging(norm.planplaats_code)
    if not norm.machinegroep:
        norm.machinegroep = get_machinegroep(norm.planplaats_code)
    if not norm.planplaats_naam:
        norm.planplaats_naam = get_planplaats_naam(norm.planplaats_code)

    db_norm = Norm(**norm.model_dump())
    db.add(db_norm)
    db.commit()
    db.refresh(db_norm)
    return db_norm


@app.put("/api/normen/{norm_id}", response_model=NormResponse)
def update_norm(norm_id: int, norm: NormCreate, db: Session = Depends(get_db)):
    db_norm = db.query(Norm).filter(Norm.id == norm_id).first()
    if not db_norm:
        raise HTTPException(status_code=404, detail="Norm niet gevonden")
    for key, value in norm.model_dump().items():
        setattr(db_norm, key, value)
    db.commit()
    db.refresh(db_norm)
    return db_norm


@app.delete("/api/normen/{norm_id}")
def delete_norm(norm_id: int, db: Session = Depends(get_db)):
    db_norm = db.query(Norm).filter(Norm.id == norm_id).first()
    if not db_norm:
        raise HTTPException(status_code=404, detail="Norm niet gevonden")
    db.delete(db_norm)
    db.commit()
    return {"ok": True}


# ── API: Settings ─────────────────────────────────────────────────

@app.get("/api/instellingen")
def list_settings(db: Session = Depends(get_db)):
    return db.query(Setting).all()


@app.put("/api/instellingen/{key}")
def update_setting(key: str, body: SettingUpdate, db: Session = Depends(get_db)):
    setting = db.query(Setting).filter(Setting.key == key).first()
    if not setting:
        raise HTTPException(status_code=404, detail="Instelling niet gevonden")
    setting.value = body.value
    db.commit()
    return {"ok": True}


# ── API: Planplaatsen reference ───────────────────────────────────

@app.get("/api/planplaatsen")
def list_planplaatsen():
    return [
        {
            "code": code,
            "naam": naam,
            "vestiging": get_vestiging(code),
            "machinegroep": get_machinegroep(code),
        }
        for code, naam in sorted(PLANPLAATS_NAMEN.items())
    ]
