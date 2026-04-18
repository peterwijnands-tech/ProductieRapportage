FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create db directory and copy seed data
RUN mkdir -p /app/db
COPY db/seed_data.json /app/db/seed_data.json

# Verify files are in place
RUN ls -la /app/backend/app/ && ls -la /app/frontend/templates/

EXPOSE 8093

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8093"]
