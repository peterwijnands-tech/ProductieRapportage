# Dashboard Productierapportage

Interactief productiedashboard ter vervanging van de Excel-rapportage.

## Starten

```bash
docker-compose up -d --build
```

Dashboard opent op: **http://localhost:8093**

## Stoppen

```bash
docker-compose down
```

## Structuur

```
backend/          Python FastAPI backend
  app/
    main.py       API endpoints + page serving
    models.py     Database modellen (normen, instellingen)
    database.py   SQLAlchemy configuratie
    ixgram_client.py  JSON-bron integratie
frontend/         HTML/CSS/JS frontend
  templates/
    index.html    Single-page dashboard
  static/
    style.css     Styling
    app.js        Frontend logica
db/               SQLite database (wordt aangemaakt bij eerste start)
```

## API Endpoints

- `GET /api/overzicht` - Management KPIs
- `GET /api/productie` - Productiedata met filters
- `GET /api/normen` - Normen CRUD
- `GET /api/instellingen` - Applicatie-instellingen
- `GET /api/planplaatsen` - Referentiedata machines
