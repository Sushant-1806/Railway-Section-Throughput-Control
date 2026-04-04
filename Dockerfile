FROM python:3.14-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

EXPOSE 5000

CMD ["sh", "-c", "python setup_database.py && exec gunicorn --worker-class gthread --threads 4 -w 1 -b 0.0.0.0:5000 run:app"]
