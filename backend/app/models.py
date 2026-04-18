from sqlalchemy import Column, Integer, String, Float, Date, DateTime, func
from backend.app.database import Base


class Norm(Base):
    __tablename__ = "normen"

    id = Column(Integer, primary_key=True, autoincrement=True)
    planplaats_code = Column(String(10), nullable=False, index=True)
    planplaats_naam = Column(String(100), nullable=True)
    vestiging = Column(String(20), nullable=True)
    machinegroep = Column(String(30), nullable=True)
    norm_omzet_per_dienst = Column(Float, nullable=True)
    norm_snelheid = Column(Float, nullable=True)
    norm_stelpercentage = Column(Float, nullable=True)
    norm_bezetting = Column(Float, nullable=True)
    geldig_vanaf = Column(Date, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Setting(Base):
    __tablename__ = "instellingen"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(50), unique=True, nullable=False)
    value = Column(String(200), nullable=False)
    label = Column(String(100), nullable=True)


class GrafiekConfig(Base):
    __tablename__ = "grafiek_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sectie = Column(String(20), nullable=False)  # drukkerij / vouwerij
    positie = Column(Integer, nullable=False)  # 1-4
    grafiek_type = Column(String(50), nullable=False)
    machines = Column(String(500), nullable=True)  # comma-separated codes
    toon_normlijn = Column(Integer, default=1)
    gebruiker = Column(String(50), nullable=True)  # null = standaard
