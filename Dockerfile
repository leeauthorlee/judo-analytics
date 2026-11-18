FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app/worker
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev
COPY analysis-model/requirements-inference.txt /app/analysis-model/requirements-inference.txt
RUN python3 -m venv /app/analysis-model/.venv && /app/analysis-model/.venv/bin/pip install --no-cache-dir -r /app/analysis-model/requirements-inference.txt --extra-index-url https://download.pytorch.org/whl/cpu
COPY analysis-model/judo_model.py analysis-model/predict.py /app/analysis-model/
COPY analysis-model/models/judo_r3d18.pt /app/analysis-model/models/judo_r3d18.pt
COPY worker/server.js worker/analysis-provider.js ./
ENV NODE_ENV=production
CMD ["npm", "start"]
