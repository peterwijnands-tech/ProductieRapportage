import os
import json
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////app/db/dashboard.db")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from backend.app.models import Norm, Setting
    from backend.app.ixgram_client import get_vestiging, get_machinegroep, get_planplaats_naam

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Seed default settings – insert missing ones
    all_defaults = [
        ("standaard_periode_dagen", "7", "Standaardperiode (dagen)"),
        ("drempel_norm_rood", "20", "Drempelwaarde normafwijking rood (%)"),
        ("drempel_norm_oranje", "10", "Drempelwaarde normafwijking oranje (%)"),
        ("drempel_norm_max_boven", "100", "Max afwijking boven norm signaal (%)"),
        ("drempel_stelpercentage", "30", "Drempelwaarde stelpercentage (%)"),
        ("drempel_max_uren_ploeg", "9", "Max uren per ploeg signaal"),
        ("kpi_papiervoorraad", "600000", "KPI papiervoorraad"),
        ("drempel_ziekteverzuim", "10", "Drempelwaarde ziekteverzuim"),
        ("standaard_vestiging", "beide", "Standaard vestiging"),
    ]
    existing_keys = {s.key for s in db.query(Setting).all()}
    added = 0
    for key, value, label in all_defaults:
        if key not in existing_keys:
            db.add(Setting(key=key, value=value, label=label))
            added += 1
    if added:
        db.commit()
        print(f"Added {added} new settings")

    # Seed norms from Excel data – insert missing ones
    seed_path = os.path.join(os.path.dirname(__file__), "..", "..", "db", "seed_data.json")
    if not os.path.exists(seed_path):
        seed_path = "/app/db/seed_data.json"

    if os.path.exists(seed_path):
        with open(seed_path) as f:
            seed = json.load(f)

        existing_codes = {n.planplaats_code for n in db.query(Norm).all()}
        added = 0
        for n in seed.get("normen_vouwmachines", []):
            code = n["code"]
            snelheid = n.get("snelheid_incl", 0)
            if snelheid and snelheid > 0 and code not in existing_codes:
                db.add(Norm(
                    planplaats_code=code,
                    planplaats_naam=get_planplaats_naam(code),
                    vestiging=get_vestiging(code),
                    machinegroep=get_machinegroep(code),
                    norm_snelheid=snelheid,
                    norm_stelpercentage=None,
                    norm_omzet_per_dienst=None,
                    norm_bezetting=None,
                    geldig_vanaf=date(2026, 1, 1),
                ))
                added += 1
        if added:
            db.commit()
            print(f"Added {added} new norms (total: {db.query(Norm).count()})")

    db.close()
