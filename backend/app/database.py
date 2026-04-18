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

    # Seed default settings if empty
    if db.query(Setting).count() == 0:
        defaults = [
            Setting(key="standaard_periode_dagen", value="7", label="Standaardperiode (dagen)"),
            Setting(key="drempel_norm_rood", value="20", label="Drempelwaarde normafwijking rood (%)"),
            Setting(key="drempel_norm_oranje", value="10", label="Drempelwaarde normafwijking oranje (%)"),
            Setting(key="drempel_stelpercentage", value="30", label="Drempelwaarde stelpercentage (%)"),
            Setting(key="kpi_papiervoorraad", value="600000", label="KPI papiervoorraad"),
            Setting(key="drempel_ziekteverzuim", value="10", label="Drempelwaarde ziekteverzuim"),
            Setting(key="standaard_vestiging", value="beide", label="Standaard vestiging"),
        ]
        db.add_all(defaults)
        db.commit()

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
